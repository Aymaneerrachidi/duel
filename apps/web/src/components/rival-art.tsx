export function RivalPortrait({ side }: { side: 'you' | 'rival' }) {
  const rival = side === 'rival';
  return <svg viewBox="0 0 200 210" aria-hidden="true" className="rival-portrait">
    <path d="M24 210v-20c0-45 34-72 76-72s76 27 76 72v20" fill={rival ? '#ffddc9' : '#dce5ff'}/>
    <path d="m79 126 21 34 21-34" fill={rival ? '#ec714d' : '#3558f5'}/>
    <rect x="83" y="110" width="34" height="32" rx="14" fill="#f7b891"/>
    <rect x="51" y="33" width="98" height="98" rx="44" fill="#ffd1af"/>
    {rival ? <path d="M49 78V56C49 24 72 15 101 18c16-15 49-2 49 20 11 16 6 34-1 42l-9-28c-21 7-42 2-55-8L59 80Z" fill="#242748"/> : <><path d="M48 72c-9-34 17-57 51-57 36 0 57 25 51 57l-14-21H66Z" fill="#242748"/><path d="M42 60c30-13 69-16 115-1" fill="none" stroke="#dce5ff" strokeWidth="12" strokeLinecap="round"/></>}
    <path d={rival ? 'm69 83 12-3m40 0 11 4' : 'm69 81 12 2m40 0 11-2'} stroke="#242748" strokeWidth="5" strokeLinecap="round"/>
    <path d="M87 106q13 12 26 0" fill="none" stroke="#242748" strokeWidth="4" strokeLinecap="round"/>
    <path d="M52 207v-28m96 28v-28" stroke={rival ? '#ec714d' : '#3558f5'} strokeWidth="3" opacity=".3"/>
    <path d={rival ? 'm89 179 9 9 17-19' : 'm89 175 8-7v26m10-19 8-7v26'} fill="none" stroke={rival ? '#c95132' : '#3558f5'} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>;
}

export function RivalArt() {
  return <div className="rival-art" role="img" aria-label="Two illustrated traders facing off: you and your rival">
    <div className="rival-orbit"/>
    <div className="contender contender-you"><span className="contender-tag">In your corner</span><RivalPortrait side="you"/><strong>You.</strong><span className="contender-caption">Your wallet. Your strategy.</span></div>
    <div className="contender contender-rival"><span className="contender-tag">Across the ring</span><RivalPortrait side="rival"/><strong>Your rival.</strong><span className="contender-caption">Same rules. Game on.</span></div>
    <span className="rival-versus">vs</span>
    <div className="rival-caption"><span className="caption-star">✳</span> A little rivalry looks good on you.</div>
  </div>;
}
