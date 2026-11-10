import html from '../public/publish.html';
import js from '../public/publish.js';
import css from '../public/publish.css';
import {StateStore} from './store.mjs';
import {createApp,cleanup} from './app.mjs';
import {secure,json} from './security.mjs';
export class PublisherState {
  constructor(ctx,env) {this.ctx=ctx;this.store=new StateStore(ctx);this.app=createApp({env,storage:this.store,assets:{html,js,css}});}
  async fetch(request) {
    if(!(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(Date.now()+300000);
    return this.app(request);
  }
  async alarm() {await cleanup(this.store);if((await this.store.list()).size>1)await this.ctx.storage.setAlarm(Date.now()+300000);}
}
export default {
  async fetch(request,env) {
    try {return await env.STATE.get(env.STATE.idFromName('owner')).fetch(request);}
    catch {return secure(json({error:'Publisher temporarily unavailable.'},503));}
  }
};
