import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { MemoryRepository } from './repository.js';
import type { State } from '../../../packages/core/src/types.js';
export class FileRepository extends MemoryRepository {
  constructor(state:State,private filename:string){super(state);}
  static async open(filename:string,seed:()=>Promise<State>){let state:State;try{state=JSON.parse(await readFile(filename,'utf8')) as State;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;state=await seed();}const repo=new FileRepository(state,filename);await repo.persist(state);return repo;}
  protected async persist(state:State){await mkdir(resolve(this.filename,'..'),{recursive:true});await writeFile(`${this.filename}.tmp`,JSON.stringify(state),'utf8');await rename(`${this.filename}.tmp`,this.filename);}
}
