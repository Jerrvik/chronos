import {
  MODULE_ID, PUBLIC_DEFAULT, clone, publicState, privateState, escapeHTML as e, safeText,
  validClock, timerProgress, timerRemaining, timerChange, timerCaption, createTimer,
  publicTimer, spotlightRemaining, spotlightChange, uuid
} from './core.js';
import {clockLabel,dateLabel,advanceDate,followingNight,calendarDate,eventsBetween} from './calendar.js';
import {CalendarUI} from './calendar-ui.js';

let chronos;
const esc = value => e(value);
const fmtTime = ms => {const secs = Math.ceil(Math.max(0,ms)/1000); return `${String(Math.floor(secs/60)).padStart(2,'0')}:${String(secs%60).padStart(2,'0')}`;};
const GM_STORAGE = () => `chronos:private:${game.world?.id}:${game.user?.id}`;
const POSITION_STORAGE = () => `chronos:positions:${game.world?.id}:${game.user?.id}`;
const activeGM = () => game.users?.contents?.filter(u=>u.isGM && u.active).sort((a,b)=>String(a.id).localeCompare(String(b.id)))[0];
const canManage = () => game.user.isGM && (!activeGM() || activeGM().id === game.user.id);
const safeInt = (n,min,max,fallback) => Number.isFinite(Number(n)) ? Math.min(max,Math.max(min,Math.trunc(Number(n)))) : fallback;
const select = (value, current) => value === current ? 'selected' : '';

class ChronosUI {
  constructor() {
    this.state = publicState(game.settings.get(MODULE_ID, 'state'));
    this.secret = this.loadPrivate();
    this.personal = this.loadPersonal();
    this.positions = this.loadPositions();
    this.collapsed = !!this.positions.collapsed;
    this.tab = 'time';
    this.managerOpen = false;
    this.calendarOpen = false;
    this.viewMonth = clone(this.state.date);
    this.day = clone(this.state.date);
    this.eventEdit = null;
    this.queue = Promise.resolve();
    this.completed = new Set();
    this.root = document.createElement('div');
    this.root.id = 'chronos-root';
    this.root.innerHTML = '<section id="chronos-hud" class="chronos-window" data-window="hud"></section><section id="chronos-manager" class="chronos-window" data-window="manager" hidden></section><section id="chronos-calendar" class="chronos-window" data-window="calendar" hidden></section><section id="chronos-builder" class="chronos-window" data-window="builder" hidden></section><input id="chronos-import-file" type="file" accept="application/json,.json" hidden><div id="chronos-visual-effect" aria-hidden="true"></div>';
    document.body.append(this.root);
    this.root.addEventListener('click', ev => this.click(ev));
    this.root.addEventListener('submit', ev => this.submit(ev));
    this.root.addEventListener('pointerdown', ev => this.dragStart(ev));
    this.root.addEventListener('change', ev=>this.change(ev));
    this.root.addEventListener('input', ev=>{if(ev.target.closest('[data-form=calendar-builder]'))this.renderPreview();});
    try{this.initializeLocalCalendar();}catch(err){console.error('Chronos: локальный календарь',err);ui.notifications?.error('Хронос: локальные данные не удалось перенести. Сохраните резервную копию.');}
    this.setPositions();
    this.render();
    this.tickHandle = window.setInterval(()=>this.tick(), 500);
    Hooks.on('updateUser',()=>this.render());
  }
  loadPrivate() {
    if (!game.user.isGM) return privateState();
    try {return privateState(JSON.parse(localStorage.getItem(GM_STORAGE())));} catch {return privateState();}
  }
  savePrivate() {
    if (!game.user.isGM) return false;
    try {localStorage.setItem(GM_STORAGE(), JSON.stringify(this.secret));return true;} catch(err) {console.warn('Chronos: сохранение локальных данных GM не удалось',err); ui.notifications?.error('Хронос: не удалось сохранить закрытые данные в браузере.');return false;}
  }
  loadPositions() {try {return JSON.parse(localStorage.getItem(POSITION_STORAGE())) || {};} catch {return {};}}
  setPositions() {
    for(const [id,initial] of Object.entries({hud:[100,110],manager:[480,110],calendar:[480,150],builder:[220,70]})) {
      const el = this.root.querySelector(`#chronos-${id}`);
      const [x,y] = this.positions[id] || initial;
      el.style.left = `${Math.min(Math.max(0,x), Math.max(0,innerWidth-52))}px`;
      el.style.top = `${Math.min(Math.max(0,y), Math.max(0,innerHeight-52))}px`;
    }
  }
  dragStart(ev) {
    if(ev.button !== 0 || !ev.target.closest('[data-drag-handle]')) return;
    if(ev.target.closest('button, input, select, textarea, a') && !ev.target.closest('.chronos-dot')) return;
    const el = ev.target.closest('[data-window]');
    if(!el) return;
    const name = el.dataset.window;
    const sx = ev.clientX, sy = ev.clientY, left=parseFloat(el.style.left)||0, top=parseFloat(el.style.top)||0;
    let moved = false;
    const move = mv => {
      if(Math.abs(mv.clientX-sx)+Math.abs(mv.clientY-sy)>5) moved=true;
      const x = Math.min(Math.max(0, left + mv.clientX-sx),Math.max(0,innerWidth-50));
      const y = Math.min(Math.max(0, top + mv.clientY-sy),Math.max(0,innerHeight-46));
      el.style.left = `${x}px`; el.style.top = `${y}px`;
    };
    const end = () => {
      window.removeEventListener('pointermove',move); window.removeEventListener('pointerup',end);
      if(moved) this.suppressClickUntil=Date.now()+350;
      this.positions[name] = [Math.round(parseFloat(el.style.left)),Math.round(parseFloat(el.style.top))];
      try{localStorage.setItem(POSITION_STORAGE(),JSON.stringify(this.positions));}catch{}
    };
    window.addEventListener('pointermove',move); window.addEventListener('pointerup',end, {once:true});
  }
  async saveWorld(mutator) {
    if(!canManage()){ui.notifications?.warn('Хронос: управлять миром может активный мастер.');return false;}
    const job=async()=>{
      if(!canManage())return false;
      try{
        const before=publicState(game.settings.get(MODULE_ID,'state')),next=clone(before);
        mutator(next);next.revision=before.revision+1;
        const normalized=publicState(next);
        await game.settings.set(MODULE_ID,'state',normalized);
        this.changedWorld(normalized);
        if(JSON.stringify(before.calendar)===JSON.stringify(normalized.calendar)){
          const reached=eventsBetween(before.date,normalized.date,[...normalized.events,...this.secret.events],normalized.calendar);
          if(reached.length)ui.notifications?.info('Хронос: наступили события — '+reached.map(x=>x.title).join(', ').slice(0,150));
        }
        return true;
      }catch(err){console.error('Chronos: сохранение не удалось',err);ui.notifications?.error('Хронос: '+err.message);return false;}
    };
    this.queue=this.queue.then(job,job);return this.queue;
  }
  updatePrivate(mutator) {
    if(!canManage()) {ui.notifications?.warn('Хронос: закрытыми записями управляет активный GM.');return false;}
    const before=clone(this.secret);mutator(this.secret);
    if(!this.savePrivate()){this.secret=before;return false;}
    this.render();return true;
  }
  changedWorld(newValue) {
    const old=this.state;
    this.state=publicState(newValue);
    try{this.onCalendarChanged(old);}catch(err){console.error('Chronos: локальная миграция',err);ui.notifications?.error('Хронос: не удалось сохранить резервную копию. Экспортируйте личные данные.');}
    if(old && old.revision !== this.state.revision) this.notifyTimerChanges(old.timers,this.state.timers);
    this.render();
  }
  notifyTimerChanges(oldTimers,newTimers) {
    const previous=new Map(oldTimers.map(t=>[t.id,t]));
    for(const timer of newTimers) {
      const old=previous.get(timer.id);
      if(!old) continue;
      const from=timerProgress(old), to=timerProgress(timer);
      if(to<1) this.completed.delete(`complete:${timer.id}:${timer.mode==='real'?timer.endsAt:timer.createdAt}`);
      if(from < .75 && to >= .75 && timer.effect !== 'none') this.effect(timer.effect);
      if(from < 1 && to >= 1) this.alertComplete(timer);
    }
  }
  alertComplete(timer) {
    const key=`complete:${timer.id}:${timer.mode==='real'?timer.endsAt:timer.createdAt}`;
    if(this.completed.has(key)) return;
    this.completed.add(key);
    ui.notifications?.info(`Хронос: завершено «${timer.name}».`);
    if(timer.effect!=='none') this.effect(timer.effect);
  }
  effect(type) {
    const fx=this.root.querySelector('#chronos-visual-effect');
    if(!game.settings.get(MODULE_ID,'reducedMotion')) {
      fx.classList.remove('chronos-fx-active');void fx.offsetWidth;fx.classList.add('chronos-fx-active');
    }
    if(!game.settings.get(MODULE_ID,'sound')) return;
    try{
      const AudioContext=window.AudioContext || window.webkitAudioContext;
      if(!AudioContext)return;
      this.audioContext ||= new AudioContext();
      if(this.audioContext.state==='suspended') void this.audioContext.resume();
      const now=this.audioContext.currentTime;
      const frequencies=type==='heartbeat'?[74,70]:type==='tension'?[240,165]:[620,780];
      frequencies.forEach((freq,i)=>{
        const osc=this.audioContext.createOscillator(), gain=this.audioContext.createGain();
        osc.type=type==='heartbeat'?'sine':'triangle';osc.frequency.value=freq;
        gain.gain.setValueAtTime(.0001,now+i*.21);gain.gain.exponentialRampToValueAtTime(.08,now+i*.21+.02);
        gain.gain.exponentialRampToValueAtTime(.0001,now+i*.21+.18);
        osc.connect(gain);gain.connect(this.audioContext.destination);
        osc.start(now+i*.21);osc.stop(now+i*.21+.19);
      });
    }catch(err){console.warn('Chronos audio',err);}
  }
  render() {
    this.root.dataset.theme=this.state.theme;
    this.renderHud(); this.renderManager(); this.renderCalendar(); this.renderBuilder(); this.tick();
  }
  renderHud() {
    const node=this.root.querySelector('#chronos-hud');
    node.classList.toggle('is-collapsed',this.collapsed);
    const timers=this.state.timers;
    if(this.collapsed){
      node.innerHTML=`<button class="chronos-dot" data-action="expand" title="Хронос: развернуть" aria-label="Развернуть Хронос" data-drag-handle><span class="chronos-clock-icon">◷</span>${timers.length?`<b class="chronos-bubble">${timers.length}</b>`:''}</button>`;
      return;
    }
    const h=clockLabel(this.state.date),isNightNow=this.state.dawn<this.state.dusk?(h<this.state.dawn||h>=this.state.dusk):(h>=this.state.dusk&&h<this.state.dawn);
    node.innerHTML=`
      <div class="chronos-hud-header" data-drag-handle><span class="chronos-logo">◷</span><strong>Хронос</strong><span class="chronos-flex"></span>
        <button data-action="calendar" class="chronos-icon" title="Календарь">▦</button>
        ${game.user.isGM?'<button data-action="manager" class="chronos-icon" title="Управление мастера">⚙</button>':''}
        <button data-action="collapse" class="chronos-icon" title="Свернуть">−</button></div>
      <button class="chronos-time" data-action="calendar" title="Открыть календарь">
        <span class="chronos-main-time">${esc(h)}</span><span class="chronos-time-meta"><span>${esc(dateLabel(this.state.date,this.state.calendar))}</span><span class="chronos-period ${isNightNow?'night':'day'}">${isNightNow?'☾ Ночь':'☀ День'}</span></span>
      </button>
       ${timers.length?`<div class="chronos-public-timers">${timers.map(t=>this.miniTimer(t)).join('')}</div>`:''}`;
  }
  miniTimer(t) {
    const pct=Math.round(timerProgress(t)*100);
    const amount=t.numbers?timerCaption(t):'Без чисел';
    return `<div class="chronos-mini-timer"><div class="chronos-mini-head"><span>${esc(t.name)}</span>${t.numbers?`<small data-timer-caption="${esc(t.id)}">${esc(amount)}</small>`:''}</div><div class="chronos-track"><span data-timer-bar="${esc(t.id)}" style="width:${pct}%"></span></div></div>`;
  }
  managerHeader() {return `<header class="chronos-bar" data-drag-handle><span class="chronos-logo">◷</span><b>Хронос</b><span class="chronos-sub">· панель мастера</span><span class="chronos-flex"></span><button data-action="close-manager" class="chronos-icon">×</button></header>`;}
  renderManager(){
    const node=this.root.querySelector('#chronos-manager');node.hidden=!this.managerOpen || !game.user.isGM;if(node.hidden)return;
    const tabs=[['time','Время'],['events','События'],['timers','Часы угроз'],['spotlight','Спотлайт']];
    const lock=!canManage()?'<p class="chronos-warning">Управление доступно активному мастеру этой игры.</p>':'';
    let body='';
    if(this.tab==='time')body=this.managerTime();
    if(this.tab==='events')body=this.managerEvents();
    if(this.tab==='timers')body=this.managerTimers();
    if(this.tab==='spotlight')body=this.managerSpotlight();
    node.innerHTML=`${this.managerHeader()}<nav class="chronos-tabs">${tabs.map(([id,label])=>`<button data-action="tab" data-value="${id}" class="${id===this.tab?'current':''}">${label}</button>`).join('')}</nav><div class="chronos-manager-body">${lock}${body}</div>`;
  }
  managerTime(){
    const d=this.state.date,h=clockLabel(d);
    return `<div class="chronos-section-head"><div><small>ТЕКУЩЕЕ ВРЕМЯ</small><h2>${esc(h)} <span class="chronos-dim">· ${esc(dateLabel(d,this.state.calendar))}</span></h2></div></div>
      <div class="chronos-inline-buttons"><button data-action="advance" data-value="60">+1 час</button><button data-action="advance" data-value="1440">+1 день</button><button class="chronos-highlight" data-action="next-night">☾ Следующая ночь</button></div>
      <form data-form="datetime" class="chronos-form grid2">${this.dateFields(d)}<label>Точное время<input name="time" type="time" value="${h}" required></label><button type="submit" class="chronos-primary">Установить</button></form>
      <div class="chronos-hairline"></div><h3>Календарь и оформление</h3><button class="chronos-secondary" data-action="builder">Конструктор календаря</button>
      <form data-form="theme" class="chronos-form"><label>Тема мира<select name="theme"><option value="gothic" ${select('gothic',this.state.theme)}>Готическая</option><option value="fantasy" ${select('fantasy',this.state.theme)}>Фэнтезийная</option></select></label><button type="submit">Применить тему</button></form>
      <div class="chronos-hairline"></div><h3>Смена дня и ночи</h3>
      <form data-form="sun" class="chronos-form three"><label>Рассвет<input name="dawn" type="time" value="${esc(this.state.dawn)}" required></label><label>Закат<input name="dusk" type="time" value="${esc(this.state.dusk)}" required></label><label>Новая ночь<input name="nextNight" type="time" value="${esc(this.state.nextNight)}" required></label><button type="submit" class="chronos-small-primary">Сохранить</button></form>
      <p class="chronos-note">Игровое время меняет мастер. Следующая ночь начинается на следующий календарный день.</p>`;
  }

  timerRow(t,secret=false){
    const pct=Math.round(timerProgress(t)*100);
    const label=secret?t.name:(this.secret.aliases[t.id]||t.name);
    return `<article class="chronos-timer-card"><div class="chronos-timer-head"><div><strong>${esc(label)}</strong><small>${secret?'Только GM':t.visibility==='anonymous'?'Анонимно для игроков':'Публично'} · ${t.mode==='real'?'Реальное время':t.mode==='steps'?'Ходы':'Шкала'}</small></div><button data-action="delete-timer" data-id="${esc(t.id)}" data-source="${secret?'private':'public'}" title="Удалить">×</button></div><div class="chronos-timer-track"><span data-timer-bar="${esc(t.id)}" style="width:${pct}%"></span></div><div class="chronos-timer-actions"><span class="chronos-timer-value" data-timer-caption="${esc(t.id)}">${esc(timerCaption(t))}</span><span class="chronos-flex"></span>${t.mode==='real'?`<button data-action="timer-action" data-id="${esc(t.id)}" data-source="${secret?'private':'public'}" data-value="toggle">${t.running?'Пауза':'▶ Пуск'}</button>`:`<button data-action="timer-action" data-id="${esc(t.id)}" data-source="${secret?'private':'public'}" data-value="minus">−</button><button data-action="timer-action" data-id="${esc(t.id)}" data-source="${secret?'private':'public'}" data-value="plus">+</button>`}<button data-action="timer-action" data-id="${esc(t.id)}" data-source="${secret?'private':'public'}" data-value="reset">↺</button></div></article>`;
  }
  managerTimers(){
    const all=[...this.state.timers.map(t=>this.timerRow(t)),...this.secret.timers.map(t=>this.timerRow(t,true))];
    return `<h2>Часы событий и угроз</h2><div class="chronos-list chronos-timer-list">${all.length?all.join(''):'<p class="chronos-empty">Пока нет ни одной шкалы.</p>'}</div>
    <div class="chronos-hairline"></div><h3>Создать новые часы</h3>
    <form data-form="timer" class="chronos-form grid2"><label class="full">Название<input name="name" maxlength="80" required placeholder="До рассвета / Прибытие охотников"></label><label>Тип<select name="mode"><option value="steps">По ходам</option><option value="manual">Ручная шкала</option><option value="real">Реальный отсчёт</option></select></label><label>Видимость<select name="visibility"><option value="named">Публичный, с названием</option><option value="anonymous">Публичный, анонимный</option><option value="gm">Только GM</option></select></label><label>Делений (2–20)<input name="max" type="number" min="2" max="20" value="6"></label><label>Минут (1–240)<input name="minutes" type="number" min="1" max="240" value="5"></label><label>Звук/эффект<select name="effect"><option value="none">Нет</option><option value="bell">Колокол</option><option value="heartbeat">Сердцебиение</option><option value="tension">Тревога</option></select></label><label class="chronos-check"><input type="checkbox" name="numbers"> Показывать игрокам числа</label><button type="submit" class="chronos-primary full">Создать часы</button></form>
    <p class="chronos-note">По ходам и ручные шкалы продвигаются только мастером. Реальный отсчёт запускается отдельно.</p>`;
  }
  managerSpotlight(){
    const t=this.secret.spotlight;
    const players=game.users.contents.filter(u=>!u.isGM);
    const options=players.map(u=>`<option value="${esc(u.id)}" ${select(u.id,t?.userId)}>${esc(u.name)}</option>`).join('');
    const remaining=spotlightRemaining(t);
    const current=players.find(u=>u.id===t?.userId);
    return `<div class="chronos-spotlight-top"><span class="chronos-mini-tag">ТОЛЬКО ДЛЯ МАСТЕРА</span><h2>Таймер спотлайта</h2><p>Помогает распределять внимание между игроками. Игроки не видят ни отсчёт, ни выбранного участника.</p></div>
    <div class="chronos-stopwatch"><small>${esc(current?.name || 'Игрок не выбран')}</small><strong data-spotlight-time>${fmtTime(remaining)}</strong><span>${t?.running?'Отсчёт запущен':t?'Пауза / ожидание':'Готов к запуску'}</span></div>
    <form data-form="spotlight" class="chronos-form grid2"><label class="full">Игрок<select name="userId" required>${options||'<option value="">Нет игроков</option>'}</select></label><label>Минут на игрока<input name="minutes" type="number" min="1" max="180" value="${t?Math.round(t.durationMs/60000):15}"></label><button type="submit" class="chronos-primary">Начать заново</button></form>
    ${t?`<div class="chronos-inline-buttons chronos-spotlight-controls"><button data-action="spotlight-action" data-value="toggle">${t.running?'Пауза':'▶ Продолжить'}</button><button data-action="spotlight-action" data-value="plus">+1 минута</button><button data-action="spotlight-action" data-value="reset">Сброс</button><button data-action="spotlight-clear">Завершить</button></div>`:''}
    <p class="chronos-note">Отсчёт реального времени не влияет на игровые часы. Переключение между игроками только вручную. При истечении звучит уведомление у GM, если включён звук.</p>`;
  }

  tick(){
    if(!this.root)return;
    const now=Date.now();
    const allTimers=[...this.state.timers,...(game.user.isGM?this.secret.timers:[])];
    for(const t of allTimers){
      const bar=this.root.querySelectorAll(`[data-timer-bar="${CSS.escape(t.id)}"]`);
      bar.forEach(el=>{el.style.width=`${Math.round(timerProgress(t,now)*100)}%`;el.classList.toggle('danger',timerProgress(t,now)>=.75);});
      this.root.querySelectorAll(`[data-timer-caption="${CSS.escape(t.id)}"]`).forEach(el=>{el.textContent=timerCaption(t,now);});
      if(t.mode==='real' && t.running && timerRemaining(t,now)===0) this.alertComplete(t);
    }
    const clock=this.root.querySelector('[data-spotlight-time]');
    if(clock)clock.textContent=fmtTime(spotlightRemaining(this.secret.spotlight,now));
    const spot=this.secret.spotlight;
    if(canManage() && spot?.running && spotlightRemaining(spot,now)===0 && !spot.notified) {
      spot.notified=true;
      this.savePrivate();
      this.effect('bell');
      ui.notifications?.info('Хронос: время спотлайта истекло.');
    }
  }
  click(ev){
    if(Date.now()<(this.suppressClickUntil||0)){ev.preventDefault();return;}
    const btn=ev.target.closest('[data-action]');if(!btn)return;
    const {action,id,source,value}=btn.dataset;
    if(this.calendarClick(action,btn.dataset))return;
    if(action==='collapse'||action==='expand'){
      this.collapsed=action==='collapse';this.positions.collapsed=this.collapsed;
      try{localStorage.setItem(POSITION_STORAGE(),JSON.stringify(this.positions));}catch{}
    }
    if(action==='manager')this.managerOpen=!this.managerOpen;
    if(action==='close-manager')this.managerOpen=false;
    if(action==='tab'){this.tab=value;this.eventEdit=null;}
    if(action==='advance'){void this.saveWorld(s=>{s.date=advanceDate(s.date,Number(value),s.calendar);});return;}
    if(action==='next-night'){void this.saveWorld(s=>{s.date=followingNight(s.date,s.nextNight,s.calendar);});return;}
    if(action==='delete-timer'){
      if(!canManage()||!window.confirm('Удалить эти часы?'))return;
      if(source==='public'){void this.saveWorld(s=>{s.timers=s.timers.filter(x=>x.id!==id);});this.updatePrivate(s=>{delete s.aliases[id];});}
      else this.updatePrivate(s=>{s.timers=s.timers.filter(x=>x.id!==id);});return;
    }
    if(action==='timer-action'){
      const change=s=>{const idx=s.timers.findIndex(t=>t.id===id);if(idx>=0)s.timers[idx]=timerChange(s.timers[idx],value);};
      if(source==='public')void this.saveWorld(change);else this.updatePrivate(change);return;
    }
    if(action==='spotlight-action'){this.updatePrivate(s=>{if(s.spotlight)s.spotlight=spotlightChange(s.spotlight,value);});return;}
    if(action==='spotlight-clear'){this.updatePrivate(s=>{s.spotlight=null;});return;}
    this.render();
  }
  change(ev){
    if(ev.target.id==='chronos-import-file'){void this.importJSON(ev.target.files?.[0]).catch(err=>ui.notifications?.error('Хронос: '+err.message));return;}
    if(ev.target.matches('[data-draft-kind]')){
      this.readDraft();const kind=ev.target.value;
      if(kind==='gregorian')this.calendarDraft={...clone(this.calendarDraft),kind,months:clone(PUBLIC_DEFAULT.calendar.months),yearStart:'m1'};
      else this.calendarDraft.kind='custom';
      this.renderBuilder();
    }
  }
  submit(ev){
    const form=ev.target.closest('[data-form]');if(!form)return;ev.preventDefault();
    if(['event','personal','calendar-builder','theme'].includes(form.dataset.form)){
      void this.calendarSubmit(form).catch(err=>ui.notifications?.error('Хронос: '+err.message));return;
    }
    if(!canManage()){ui.notifications?.warn('Хронос: доступно только активному мастеру.');return;}
    const fd=new FormData(form),pick=k=>String(fd.get(k)||'');
    try{
      switch(form.dataset.form){
        case 'datetime':{const date=calendarDate(this.readDate(fd),pick('time'),this.state.calendar);void this.saveWorld(s=>{s.date=date;});break;}
        case 'sun':{
          const [dawn,dusk,night]=['dawn','dusk','nextNight'].map(pick);if(![dawn,dusk,night].every(validClock))throw new Error('Неверный формат часов');
          void this.saveWorld(s=>{s.dawn=dawn;s.dusk=dusk;s.nextNight=night;});break;
        }
        case 'timer':{
          const name=safeText(pick('name'),80),visibility=pick('visibility');
          if(!name)throw new Error('Нужно название часов');
          if(!['steps','manual','real'].includes(pick('mode'))||!['named','anonymous','gm'].includes(visibility))throw new Error('Недопустимый тип часов');
          const timer=createTimer({name,mode:pick('mode'),visibility,max:safeInt(pick('max'),2,20,6),minutes:safeInt(pick('minutes'),1,240,5),numbers:fd.has('numbers'),effect:pick('effect')});
          if(visibility==='gm')this.updatePrivate(s=>s.timers.push(timer));
          else{if(visibility==='anonymous'&&!this.updatePrivate(s=>{s.aliases[timer.id]=name;}))return;void this.saveWorld(s=>s.timers.push(publicTimer(timer)));}
          form.reset();break;
        }
        case 'spotlight':{
          const userId=pick('userId'),minutes=safeInt(pick('minutes'),1,180,15);
          if(!game.users.contents.some(x=>x.id===userId&&!x.isGM))throw new Error('Выберите игрока');
          this.updatePrivate(s=>{const durationMs=minutes*60000;s.spotlight={userId,durationMs,remainingMs:durationMs,running:true,endsAt:Date.now()+durationMs,notified:false};});break;
        }
      }
    }catch(err){ui.notifications?.error('Хронос: '+err.message);}
  }
}
Object.assign(ChronosUI.prototype,CalendarUI);


Hooks.once('init',()=>{
  game.settings.register(MODULE_ID,'state',{
    name:'Состояние времени и публичных событий',hint:'Синхронизируемые данные мира. Не сохраняйте здесь секреты мастера.',
    scope:'world',config:false,type:Object,default:clone(PUBLIC_DEFAULT),onChange:value=>chronos?.changedWorld(value)
  });
  game.settings.register(MODULE_ID,'sound',{
    name:'Хронос: звуковые уведомления',hint:'Разрешить короткие сигналы календаря и часов событий в этом браузере.',
    scope:'client',config:true,type:Boolean,default:true
  });
  game.settings.register(MODULE_ID,'reducedMotion',{
    name:'Хронос: уменьшить анимацию',hint:'Отключить подсветку края экрана.',
    scope:'client',config:true,type:Boolean,default:false
  });
});
Hooks.once('ready',()=>{
  chronos=new ChronosUI();
  // Useful when testing in developer console; does not publish private state.
  console.info('Chronos 0.2.0-beta.1 ready. GM controls via the gear icon.');
});
