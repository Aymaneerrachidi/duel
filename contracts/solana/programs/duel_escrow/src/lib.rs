use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, Transfer};
use crate::program::DuelEscrow;

declare_id!("Fg6PaFpoGXkYsidMpWxTWqkZcM2Y8aVzWBfVvZo1qS5C");
const DAY: i64 = 86_400;

#[program]
pub mod duel_escrow {
    use super::*;
    pub fn initialize(ctx: Context<Initialize>, authority: Pubkey) -> Result<()> {
        require!(authority != Pubkey::default(), EscrowError::InvalidParticipant);
        ctx.accounts.config.set_inner(Config { administrator: ctx.accounts.administrator.key(), authority, paused: false, bump: ctx.bumps.config });
        Ok(())
    }
    pub fn set_paused(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
        ctx.accounts.config.paused = paused;
        Ok(())
    }
    pub fn create_challenge(ctx: Context<CreateChallenge>, id: [u8;32], amount: u64, duration: i64, expires_at: i64) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(!ctx.accounts.config.paused, EscrowError::Paused);
        require!(amount > 0, EscrowError::InvalidAmount);
        require!(duration == DAY || duration == DAY * 3 || duration == DAY * 7, EscrowError::InvalidDuration);
        require!(expires_at > now && expires_at <= now.checked_add(DAY * 7).ok_or(EscrowError::Overflow)?, EscrowError::Deadline);
        require!(ctx.accounts.opponent.key() != ctx.accounts.challenger.key() && ctx.accounts.opponent.key() != Pubkey::default(), EscrowError::InvalidParticipant);
        let duel = &mut ctx.accounts.duel;
        duel.set_inner(Duel { id, challenger:ctx.accounts.challenger.key(), opponent:ctx.accounts.opponent.key(), authority:ctx.accounts.config.authority, amount, duration, created_at:now, expires_at, accepted_at:0, end_at:0, status:DuelStatus::Open, result_hash:[0;32], bump:ctx.bumps.duel });
        system_program::transfer(CpiContext::new(ctx.accounts.system_program.to_account_info(), Transfer { from:ctx.accounts.challenger.to_account_info(), to:duel.to_account_info() }), amount)?;
        emit!(DuelCreated { id, challenger:duel.challenger, opponent:duel.opponent, amount });
        Ok(())
    }
    pub fn accept_challenge(ctx: Context<AcceptChallenge>, amount: u64) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(!ctx.accounts.config.paused, EscrowError::Paused);
        let duel = &mut ctx.accounts.duel;
        require!(duel.status == DuelStatus::Open, EscrowError::InvalidState);
        require!(now < duel.expires_at, EscrowError::Deadline);
        require!(amount == duel.amount, EscrowError::InvalidAmount);
        duel.end_at = now.checked_add(duel.duration).ok_or(EscrowError::Overflow)?;
        duel.accepted_at = now;
        duel.status = DuelStatus::Active;
        system_program::transfer(CpiContext::new(ctx.accounts.system_program.to_account_info(), Transfer { from:ctx.accounts.opponent.to_account_info(), to:duel.to_account_info() }), amount)?;
        emit!(DuelAccepted { id:duel.id, opponent:duel.opponent, end_at:duel.end_at });
        Ok(())
    }
    pub fn cancel_expired_challenge(ctx: Context<CancelChallenge>) -> Result<()> {
        let duel = &mut ctx.accounts.duel;
        require!(duel.status == DuelStatus::Open, EscrowError::InvalidState);
        require!(Clock::get()?.unix_timestamp >= duel.expires_at, EscrowError::Deadline);
        duel.status = DuelStatus::Cancelled;
        duel.sub_lamports(duel.amount)?;
        ctx.accounts.challenger.add_lamports(duel.amount)?;
        emit!(DuelCancelled { id:duel.id });
        Ok(())
    }
    pub fn settle_duel(ctx: Context<SettleDuel>, outcome: u8, result_hash: [u8;32]) -> Result<()> {
        require!(!ctx.accounts.config.paused, EscrowError::Paused);
        let duel = &mut ctx.accounts.duel;
        require!(duel.status == DuelStatus::Active, EscrowError::InvalidState);
        require!(Clock::get()?.unix_timestamp >= duel.end_at, EscrowError::Deadline);
        require!(outcome <= 2 && result_hash != [0;32], EscrowError::InvalidResult);
        let pot = duel.amount.checked_mul(2).ok_or(EscrowError::Overflow)?;
        duel.status = DuelStatus::Settled;
        duel.result_hash = result_hash;
        duel.sub_lamports(pot)?;
        if outcome == 0 { ctx.accounts.challenger.add_lamports(duel.amount)?; ctx.accounts.opponent.add_lamports(duel.amount)?; }
        else if outcome == 1 { ctx.accounts.challenger.add_lamports(pot)?; }
        else { ctx.accounts.opponent.add_lamports(pot)?; }
        emit!(DuelSettled { id:duel.id, outcome, result_hash });
        Ok(())
    }
    pub fn refund_duel(ctx: Context<RefundDuel>) -> Result<()> {
        let duel = &mut ctx.accounts.duel;
        require!(duel.status == DuelStatus::Active, EscrowError::InvalidState);
        require!(Clock::get()?.unix_timestamp >= duel.end_at.checked_add(7 * DAY).ok_or(EscrowError::Overflow)?, EscrowError::Deadline);
        require!(ctx.accounts.participant.key() == duel.challenger || ctx.accounts.participant.key() == duel.opponent, EscrowError::InvalidParticipant);
        let pot = duel.amount.checked_mul(2).ok_or(EscrowError::Overflow)?;
        duel.status = DuelStatus::Cancelled;
        duel.sub_lamports(pot)?;
        ctx.accounts.challenger.add_lamports(duel.amount)?;
        ctx.accounts.opponent.add_lamports(duel.amount)?;
        emit!(DuelRefunded { id:duel.id });
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(constraint = program.programdata_address()? == Some(program_data.key()) @ EscrowError::InvalidParticipant)]
    pub program: Program<'info, DuelEscrow>,
    #[account(constraint = program_data.upgrade_authority_address == Some(administrator.key()) @ EscrowError::InvalidParticipant)]
    pub program_data: Account<'info, ProgramData>,
    #[account(init, payer=administrator, space=8+Config::INIT_SPACE, seeds=[b"config"], bump)]
    pub config: Account<'info, Config>,
    #[account(mut)] pub administrator: Signer<'info>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct SetPaused<'info> {
    #[account(mut, seeds=[b"config"], bump=config.bump, has_one=administrator)] pub config: Account<'info, Config>,
    pub administrator: Signer<'info>,
}
#[derive(Accounts)]
#[instruction(id: [u8;32])]
pub struct CreateChallenge<'info> {
    #[account(seeds=[b"config"], bump=config.bump)] pub config: Account<'info, Config>,
    #[account(init, payer=challenger, space=8+Duel::INIT_SPACE, seeds=[b"duel", challenger.key().as_ref(), id.as_ref()], bump)] pub duel: Account<'info, Duel>,
    #[account(mut)] pub challenger: Signer<'info>,
    pub opponent: SystemAccount<'info>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct AcceptChallenge<'info> {
    #[account(seeds=[b"config"], bump=config.bump)] pub config: Account<'info, Config>,
    #[account(mut, seeds=[b"duel", duel.challenger.as_ref(), duel.id.as_ref()], bump=duel.bump, has_one=opponent)] pub duel: Account<'info, Duel>,
    #[account(mut)] pub opponent: Signer<'info>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct CancelChallenge<'info> {
    #[account(mut, seeds=[b"duel", duel.challenger.as_ref(), duel.id.as_ref()], bump=duel.bump, has_one=challenger)] pub duel: Account<'info, Duel>,
    #[account(mut)] pub challenger: Signer<'info>,
}
#[derive(Accounts)]
pub struct SettleDuel<'info> {
    #[account(seeds=[b"config"], bump=config.bump)] pub config: Account<'info, Config>,
    #[account(mut, seeds=[b"duel", duel.challenger.as_ref(), duel.id.as_ref()], bump=duel.bump, has_one=authority, has_one=challenger, has_one=opponent)] pub duel: Account<'info, Duel>,
    pub authority: Signer<'info>,
    #[account(mut)] pub challenger: SystemAccount<'info>,
    #[account(mut)] pub opponent: SystemAccount<'info>,
}
#[derive(Accounts)]
pub struct RefundDuel<'info> {
    #[account(mut, seeds=[b"duel", duel.challenger.as_ref(), duel.id.as_ref()], bump=duel.bump, has_one=challenger, has_one=opponent)] pub duel: Account<'info, Duel>,
    pub participant: Signer<'info>,
    #[account(mut)] pub challenger: SystemAccount<'info>,
    #[account(mut)] pub opponent: SystemAccount<'info>,
}
#[account]
#[derive(InitSpace)]
pub struct Config { pub administrator:Pubkey, pub authority:Pubkey, pub paused:bool, pub bump:u8 }
#[account]
#[derive(InitSpace)]
pub struct Duel { pub id:[u8;32], pub challenger:Pubkey, pub opponent:Pubkey, pub authority:Pubkey, pub amount:u64, pub duration:i64, pub created_at:i64, pub expires_at:i64, pub accepted_at:i64, pub end_at:i64, pub status:DuelStatus, pub result_hash:[u8;32], pub bump:u8 }
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, InitSpace)]
pub enum DuelStatus { Open, Active, Settled, Cancelled }
#[event] pub struct DuelCreated { pub id:[u8;32],pub challenger:Pubkey,pub opponent:Pubkey,pub amount:u64 }
#[event] pub struct DuelAccepted { pub id:[u8;32],pub opponent:Pubkey,pub end_at:i64 }
#[event] pub struct DuelSettled { pub id:[u8;32],pub outcome:u8,pub result_hash:[u8;32] }
#[event] pub struct DuelCancelled { pub id:[u8;32] }
#[event] pub struct DuelRefunded { pub id:[u8;32] }
#[error_code]
pub enum EscrowError {
    #[msg("Escrow is paused")] Paused,
    #[msg("Invalid participant")] InvalidParticipant,
    #[msg("Invalid deposit amount")] InvalidAmount,
    #[msg("Duration must be 1, 3 or 7 days")] InvalidDuration,
    #[msg("Invalid duel state")] InvalidState,
    #[msg("Deadline constraint failed")] Deadline,
    #[msg("Invalid settlement result")] InvalidResult,
    #[msg("Arithmetic overflow")] Overflow,
}
