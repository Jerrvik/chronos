import {clone,escapeHTML as esc,uuid,publicState,privateState,publicTimer} from './core.js';
import {EARTH_CALENDAR,calendarConfig,orderedMonths,monthDays,parseDate,dateKey,dateLabel,clockLabel,calendarDate,validDate,weekday,adjacentMonth,eventOnDay,relocateDate,relocateEvents,cleanEvent} from './calendar.js';

const key=name=>`chronos:${name}:${game.world?.id}:${game.user?.id}`;
const chosen=(a,b)=>a===b?'selected':'';
const gm=()=>game.user.isGM;
const color=value=>/^#[0-9a-f]{6}$/i.test(value)?value:'#b96b86';
const report=err=>{console.error('Chronos',err);ui.notifications?.error(`Хронос: ${err.message}`);};

/** Shared UI for both Foundry generations. Local content is never passed to settings or sockets. */
export const CalendarUI={
  loadPersonal(){try{const raw=JSON.parse(localStorage.getItem(key('personal')));return Array.isArray(raw)?raw:[];}catch{return [];}},
  savePersonal(){localStorage.setItem(key('personal'),JSON.stringify(this.personal));},
  initializeLocalCalendar(){
    try{this.localCalendar=calendarConfig(JSON.parse(localStorage.getItem(key('local-calendar')))||EARTH_CALENDAR);}catch{this.localCalendar=clone(EARTH_CALENDAR);}
    if(JSON.stringify(this.localCalendar)!==JSON.stringify(this.state.calendar)&&(this.personal.length||(gm()&&this.secret.events.length))){
      this.onCalendarChanged({...this.state,calendar:this.localCalendar},true);
    }else localStorage.setItem(key('local-calendar'),JSON.stringify(this.state.calendar));
    this.localCalendar=clone(this.state.calendar);
  },
  backupLocal(reason,state=this.state,localOnly=false){
    const backup={format:'chronos-backup',version:2,createdAt:new Date().toISOString(),reason,localOnly,state:clone(state),personal:clone(this.personal),...(gm()?{private:clone(this.secret)}:{})};
    const backups=JSON.parse(localStorage.getItem(key('backups'))||'[]');
    localStorage.setItem(key('backups'),JSON.stringify([backup,...backups].slice(0,5)));
    return backup;
  },
  downloadJSON(value,name){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);},
  localBackup(){this.downloadJSON(this.backupLocal('manual'),`chronos-backup-${game.user.id}.json`);},
  onCalendarChanged(oldState,localOnly=false){
    if(JSON.stringify(oldState.calendar)===JSON.stringify(this.state.calendar))return;
    this.backupLocal('calendar-change',oldState,localOnly);
    this.personal=relocateEvents(this.personal,oldState.calendar,this.state.calendar);this.savePersonal();
    if(gm()){this.secret.events=relocateEvents(this.secret.events,oldState.calendar,this.state.calendar);if(!this.savePrivate())throw new Error('Не удалось сохранить закрытые события');}
    localStorage.setItem(key('local-calendar'),JSON.stringify(this.state.calendar));this.localCalendar=clone(this.state.calendar);
    this.day=clone(this.state.date);this.viewMonth=clone(this.state.date);this.noteEdit=null;
    if(this.personal.length)ui.notifications?.info('Хронос: личные записи сохранены в новом календаре. Предыдущая версия доступна в резервной копии.');
  },
  dateFields(date,prefix=''){
    const c=this.state.calendar,d=parseDate(date,c);
    return `<div class="chronos-date-fields full"><label>Год<input name="${prefix}year" type="number" min="-999999" max="999999" value="${d.year}" required></label><label>Месяц<select name="${prefix}month">${orderedMonths(c).map(m=>`<option value="${esc(m.id)}" ${chosen(m.id,d.month)}>${esc(m.name)}</option>`).join('')}</select></label><label>День<input name="${prefix}day" type="number" min="1" max="1000" value="${d.day}" required></label></div>`;
  },
  readDate(fd,prefix=''){return {year:Number(fd.get(prefix+'year')),month:String(fd.get(prefix+'month')),day:Number(fd.get(prefix+'day'))};},
  eventForm(item,personal=false){
    const d=item?.date||this.eventDate||(personal?this.day:this.state.date);
    return `<form data-form="${personal?'personal':'event'}" class="chronos-form grid2">
      <label class="full">Название<input name="title" value="${esc(item?.title||'')}" maxlength="100" required></label>
      ${this.dateFields(d)}
      <label>Время <small>необязательно</small><input name="time" type="time" value="${esc(item?.time||'')}"></label>
      <label>Цвет метки<input name="color" type="color" value="${color(item?.color)}"></label>
      <label class="full">${personal?'Комментарий':'Описание'}<textarea name="note" rows="2" maxlength="2000">${esc(item?.note||'')}</textarea></label>
      ${personal?'':`<label class="chronos-check"><input name="visible" type="checkbox" ${item?.source==='public'?'checked':''}> Показывать игрокам</label><label class="chronos-check"><input name="annual" type="checkbox" ${item?.annual?'checked':''}> Каждый год</label>`}
      <button class="chronos-primary" type="submit">${item?'Сохранить':'Добавить'}</button><button type="button" data-action="${personal?'cancel-note':'cancel-event'}">Отмена</button>
    </form>`;
  },
  managerEvents(){
    const all=[...this.state.events.map(x=>({...x,source:'public'})),...this.secret.events.map(x=>({...x,source:'private'}))];
    const edit=this.eventEdit?all.find(x=>x.id===this.eventEdit.id&&x.source===this.eventEdit.source):null;
    return `<div class="chronos-section-head"><h2>События календаря</h2><button data-action="calendar">▦ Календарь</button></div>
      ${this.eventForm(edit)}<div class="chronos-hairline"></div><div class="chronos-list">${all.length?all.map(x=>`<article class="chronos-event-row"><span class="chronos-event-marker" style="background:${color(x.color)}"></span><div><strong>${esc(x.title)}</strong><small>${esc(dateLabel(parseDate(x.date,this.state.calendar),this.state.calendar))}${x.annual?' · ежегодно':''}</small><label class="chronos-visibility"><input type="checkbox" data-action="toggle-event" data-id="${esc(x.id)}" data-source="${x.source}" ${x.source==='public'?'checked':''}> Показывать игрокам</label></div><button data-action="edit-event" data-id="${esc(x.id)}" data-source="${x.source}" title="Изменить">✎</button><button data-action="delete-event" data-id="${esc(x.id)}" data-source="${x.source}" title="Удалить">×</button></article>`).join(''):'<p class="chronos-empty">Событий пока нет.</p>'}</div>
      <p class="chronos-note">Скрытые записи хранятся в этом профиле браузера мастера. Сделайте резервную копию перед сменой браузера.</p><div class="chronos-inline-buttons"><button data-action="backup">Скачать резервную копию</button><button data-action="import-backup">Восстановить копию</button></div>`;
  },
  calendarGrid(c,date,events=[],preview=false){
    const first={year:date.year,month:date.month,day:1};
    const pad=(weekday(first,c)-c.firstWeekday+c.weekdays.length)%c.weekdays.length;
    const days=c.weekdays.map((_,i)=>c.weekdays[(i+c.firstWeekday)%c.weekdays.length]);
    const cells=Array(pad).fill('<span></span>');
    for(let day=1;day<=monthDays(c,date.year,date.month);day++){
      const d={year:date.year,month:date.month,day},matches=events.filter(e=>eventOnDay(e,d,c));
      cells.push(`<button type="button" ${preview?'disabled':`data-action="calendar-day" data-value="${dateKey(d)}"`} class="${!preview&&dateKey(this.day)===dateKey(d)?'selected':''} ${!preview&&dateKey(this.state.date)===dateKey(d)?'today':''}" ${matches.length?`aria-label="${day}: ${matches.length} записей"`:''}>${day}<span class="chronos-day-dots">${matches.slice(0,3).map(e=>`<i class="${e.source==='personal'?'personal':''}" style="--event-color:${color(e.color)}"></i>`).join('')}</span></button>`);
    }
    return `<div class="chronos-grid-scroll" style="--week-days:${c.weekdays.length}"><div class="chronos-calendar-grid chronos-weekdays">${days.map(d=>`<span title="${esc(d)}">${esc(d)}</span>`).join('')}</div><div class="chronos-calendar-grid">${cells.join('')}</div></div>`;
  },
  renderCalendar(){
    const node=this.root.querySelector('#chronos-calendar');node.hidden=!this.calendarOpen;if(node.hidden)return;
    const c=this.state.calendar;
    if(!c.months.some(m=>m.id===this.viewMonth.month))this.viewMonth=clone(this.state.date);
    const all=[...this.state.events.map(x=>({...x,source:'public'})),...(gm()?this.secret.events.map(x=>({...x,source:'private'})):[]),...this.personal.map(x=>({...x,source:'personal'}))];
    const details=all.filter(x=>eventOnDay(x,this.day,c)).sort((a,b)=>(a.time||'').localeCompare(b.time||''));
    const edit=this.personal.find(x=>x.id===this.noteEdit);
    node.innerHTML=`<header class="chronos-bar" data-drag-handle><b>▦ ${esc(c.name)}</b><span class="chronos-flex"></span><button class="chronos-icon" data-action="close-calendar" aria-label="Закрыть календарь">×</button></header>
      <div class="chronos-calendar-content"><div class="chronos-month-nav"><button data-action="month" data-value="-1">‹</button><strong>${esc(c.months.find(x=>x.id===this.viewMonth.month)?.name)} · ${this.viewMonth.year}</strong><button data-action="month" data-value="1">›</button></div>
      ${this.calendarGrid(c,this.viewMonth,all)}<div class="chronos-hairline"></div><div class="chronos-calendar-daytitle">${esc(dateLabel(this.day,c))}</div>
      <div class="chronos-list">${details.length?details.map(x=>`<article class="chronos-day-event ${x.source==='personal'?'is-personal':''}" style="border-color:${color(x.color)}"><b>${esc(x.time||'Весь день')} · ${esc(x.title)}</b>${x.note?`<p>${esc(x.note)}</p>`:''}<small>${x.source==='private'?'🔒 Только мастер':x.source==='personal'?'◇ Личная запись':'Публичное событие'}${x.annual?' · ежегодно':''}</small>${x.source==='personal'?`<div class="chronos-note-actions"><button data-action="edit-note" data-id="${esc(x.id)}">Изменить / перенести</button><button data-action="delete-note" data-id="${esc(x.id)}">Удалить</button></div>`:''}</article>`).join(''):'<p class="chronos-empty">Записей нет.</p>'}</div>
      ${gm()?'<button class="chronos-secondary" data-action="calendar-add">+ Событие мастера</button>':this.noteEdit?this.eventForm(edit,true):'<button class="chronos-secondary" data-action="add-note">+ Личная запись</button>'}
      ${!gm()?'<p class="chronos-note">Личные записи доступны только вам в этом профиле браузера.</p><div class="chronos-inline-buttons"><button data-action="export-personal">Экспорт заметок</button><button data-action="import-personal">Импорт заметок</button><button data-action="export-local-backups">Резервные копии</button></div>':''}</div>`;
  },
  openBuilder(){if(!gm())return;this.calendarDraft=clone(this.state.calendar);this.draftYear=this.state.date.year;this.previewMonth=this.state.date.month;this.builderOpen=true;this.renderBuilder();},
  readDraft(){
    const form=this.root.querySelector('[data-form=calendar-builder]');
    if(!form)return this.calendarDraft;
    const fd=new FormData(form),d=clone(this.calendarDraft);
    d.name=String(fd.get('name')||'');d.era=String(fd.get('era')||'');
    d.firstWeekday=Number(fd.get('firstWeekday'));d.yearStart=String(fd.get('yearStart'));
    d.months=d.months.map(m=>({...m,name:String(fd.get('monthName-'+m.id)||''),days:Number(fd.get('monthDays-'+m.id))}));
    d.weekdays=d.weekdays.map((_,i)=>String(fd.get('weekday-'+i)||''));
    this.draftYear=Number(fd.get('year'));this.previewMonth=String(fd.get('previewMonth')||this.previewMonth);
    this.calendarDraft=d;return d;
  },
  renderBuilder(){
    const node=this.root.querySelector('#chronos-builder');node.hidden=!this.builderOpen||!gm();if(node.hidden)return;
    const d=this.calendarDraft,earth=d.kind==='gregorian';
    if(!d.months.some(m=>m.id===this.previewMonth))this.previewMonth=d.months[0].id;
    node.innerHTML=`<header class="chronos-bar" data-drag-handle><b>Конструктор календаря</b><span class="chronos-flex"></span><button class="chronos-icon" data-action="close-builder">×</button></header><div class="chronos-builder-body">
      <form data-form="calendar-builder" class="chronos-form grid2"><label>Календарь<select name="kind" data-draft-kind><option value="gregorian" ${chosen('gregorian',d.kind)}>Стандартный земной</option><option value="custom" ${chosen('custom',d.kind)}>Пользовательский</option></select></label><label>Текущий год<input name="year" type="number" min="-999999" max="999999" value="${this.draftYear}" required></label>
      <label>Название<input name="name" maxlength="80" value="${esc(d.name)}" required></label><label>Летоисчисление<input name="era" maxlength="100" value="${esc(d.era)}" placeholder="Эра Королей"></label>
      <div class="full chronos-builder-columns"><section><h3>Месяцы</h3><div class="chronos-builder-list">${d.months.map((m,i)=>`<div class="chronos-month-row"><input aria-label="Название месяца ${i+1}" name="monthName-${m.id}" maxlength="60" value="${esc(m.name)}" ${earth?'readonly':''} required><input aria-label="Дней в месяце ${i+1}" name="monthDays-${m.id}" type="number" min="1" max="1000" value="${m.days}" ${earth?'readonly':''} required>${earth?'':`<button type="button" data-action="month-up" data-id="${m.id}" ${i===0?'disabled':''} title="Выше">↑</button><button type="button" data-action="month-down" data-id="${m.id}" ${i===d.months.length-1?'disabled':''} title="Ниже">↓</button><button type="button" data-action="remove-month" data-id="${m.id}" ${d.months.length===1?'disabled':''} title="Удалить">×</button>`}</div>`).join('')}</div>${earth?'<p class="chronos-note">Григорианские месяцы и високосные годы.</p>':'<button type="button" data-action="add-month">+ Месяц</button>'}
      <div class="chronos-hairline"></div><h3>Дни недели</h3><div class="chronos-builder-list">${d.weekdays.map((name,i)=>`<div class="chronos-weekday-row"><input name="weekday-${i}" aria-label="День недели ${i+1}" maxlength="40" value="${esc(name)}" required><button type="button" data-action="remove-weekday" data-value="${i}" ${d.weekdays.length===1?'disabled':''}>×</button></div>`).join('')}</div><button type="button" data-action="add-weekday">+ День недели</button></section>
      <section><h3>Предпросмотр</h3><label>Месяц<select name="previewMonth">${d.months.map(m=>`<option value="${m.id}" ${chosen(m.id,this.previewMonth)}>${esc(m.name)}</option>`).join('')}</select></label><div id="chronos-calendar-preview"></div><div class="chronos-hairline"></div><label>Первый день недели<select name="firstWeekday">${d.weekdays.map((n,i)=>`<option value="${i}" ${chosen(i,d.firstWeekday)}>${esc(n)}</option>`).join('')}</select></label><label>Начало календарного года<select name="yearStart">${d.months.map(m=>`<option value="${m.id}" ${chosen(m.id,d.yearStart)}>${esc(m.name)}</option>`).join('')}</select></label><p class="chronos-note">Год начинается с первого дня выбранного месяца. В пользовательском календаре длина месяцев постоянна.</p></section></div>
      <button type="submit" class="chronos-primary full">Применить для мира</button><button type="button" data-action="export-calendar">Экспорт JSON</button><button type="button" data-action="import-calendar">Импорт JSON</button></form></div>`;
    this.renderPreview();
  },
  renderPreview(){
    const node=this.root.querySelector('#chronos-calendar-preview');if(!node)return;
    try{const c=calendarConfig(this.readDraft()),date={year:this.draftYear,month:this.previewMonth,day:1};if(!validDate(date,c))throw new Error('Укажите корректный год');node.innerHTML=`<p class="chronos-note">${esc(c.era)} · ${date.year}</p>${this.calendarGrid(c,date,[],true)}`;}catch(err){node.textContent=err.message;}
  },
  requestImport(type){this.importType=type;const input=this.root.querySelector('#chronos-import-file');input.value='';input.click();},
  async importJSON(file){
    if(!file)return;if(file.size>5_000_000)throw new Error('Файл слишком большой (максимум 5 МБ)');
    const data=JSON.parse(await file.text()),type=this.importType;
    if(type==='calendar'){
      if(!gm())return;
      this.calendarDraft=calendarConfig(data.calendar||data);this.draftYear=Number.isInteger(data.year)?data.year:this.state.date.year;this.previewMonth=this.calendarDraft.yearStart;this.builderOpen=true;this.renderBuilder();return;
    }
    if(type==='personal'){
      const payload=data.format==='chronos-local-backups'?data.backups?.[0]:data;
      const records=payload?.format==='chronos-backup'?payload.personal:payload?.events;
      const sourceCalendar=payload?.format==='chronos-backup'?payload.state?.calendar:payload?.calendar;
      if(!['chronos-personal','chronos-backup'].includes(payload?.format)||!Array.isArray(records)||records.length>10000)throw new Error('Это не файл личных записей Хроноса');
      const source=calendarConfig(sourceCalendar),events=records.map(e=>cleanEvent(e,source));
      const relocated=relocateEvents(events,source,this.state.calendar);
      if(!window.confirm(`Импортировать ${events.length} личных записей? Даты будут сопоставлены с текущим календарём. Существующие записи сохранятся.`))return;
      this.backupLocal('personal-import');const merged=new Map(this.personal.map(x=>[x.id,x]));for(const e of relocated)merged.set(e.id,e);this.personal=[...merged.values()];this.savePersonal();this.renderCalendar();return;
    }
    if(type==='backup'){
      if(!gm()||data.format!=='chronos-backup'||!data.private||!data.state)throw new Error('Нужна резервная копия мастера');
      const source=calendarConfig(data.state.calendar||EARTH_CALENDAR);
      if(!Array.isArray(data.private.events)||!Array.isArray(data.private.timers)||data.private.events.length>10000||data.private.timers.length>10000)throw new Error('Повреждённая резервная копия');
      const secret=privateState(data.private);secret.events=secret.events.map(e=>cleanEvent(e,source));
      if(data.localOnly){
        if(!window.confirm('Восстановить только локальные закрытые данные мастера? Даты будут сопоставлены с текущим календарём.'))return;
        this.backupLocal('before-local-restore');secret.events=relocateEvents(secret.events,source,this.state.calendar);this.updatePrivate(s=>Object.assign(s,secret));return;
      }
      const restored=publicState(data.state);
      restored.events=restored.events.map(e=>cleanEvent(e,source));
      restored.timers=restored.timers.map(publicTimer).filter(Boolean);
      if(!window.confirm('Восстановить календарь, время, публичные и закрытые данные мастера из файла? Текущие данные будут заменены. Перед восстановлением сохранится резервная копия.'))return;
      this.downloadJSON(this.backupLocal('before-restore'),`chronos-before-restore-${Date.now()}.json`);
      if(await this.saveWorld(s=>Object.assign(s,restored)))this.updatePrivate(s=>Object.assign(s,secret));
    }
  },
  async calendarSubmit(form){
    const fd=new FormData(form),type=form.dataset.form;
    if(type==='personal'){
      const item=cleanEvent({id:this.noteEdit==='new'?uuid():this.noteEdit,title:fd.get('title'),date:this.readDate(fd),time:fd.get('time'),note:fd.get('note'),color:fd.get('color')},this.state.calendar);
      const next=this.personal.filter(x=>x.id!==item.id);next.push(item);localStorage.setItem(key('personal'),JSON.stringify(next));this.personal=next;this.noteEdit=null;this.renderCalendar();return;
    }
    if(!gm())return;
    if(type==='theme'){await this.saveWorld(s=>{s.theme=fd.get('theme')==='fantasy'?'fantasy':'gothic';});return;}
    if(type==='event'){
      const source=fd.has('visible')?'public':'private',old=this.eventEdit;
      const item=cleanEvent({id:old?.id||uuid(),title:fd.get('title'),date:this.readDate(fd),time:fd.get('time'),note:fd.get('note'),color:fd.get('color'),annual:fd.has('annual')},this.state.calendar);
      if(source==='public'){
        const saved=await this.saveWorld(s=>{s.events=s.events.filter(x=>x.id!==item.id);s.events.push(item);});
        if(saved&&old?.source==='private')this.updatePrivate(s=>{s.events=s.events.filter(x=>x.id!==item.id);});
      }else{
        const saved=this.updatePrivate(s=>{s.events=s.events.filter(x=>x.id!==item.id);s.events.push(item);});
        if(saved&&old?.source==='public')await this.saveWorld(s=>{s.events=s.events.filter(x=>x.id!==item.id);});
      }
      this.eventEdit=null;this.eventDate=null;this.render();return;
    }
    if(type==='calendar-builder'){
      const nextCalendar=calendarConfig(this.readDraft());
      if(!Number.isInteger(this.draftYear)||Math.abs(this.draftYear)>999999)throw new Error('Некорректный текущий год');
      const before=this.state,all=[...before.events,...this.secret.events];
      const invalid=all.filter(e=>relocateDate(e.date,before.calendar,nextCalendar).changed);
      const current=relocateDate({...before.date,year:this.draftYear},before.calendar,nextCalendar);
      const message=invalid.length?`После изменения календаря нужно перенести ${invalid.length} записей на ближайшие допустимые даты:\n${invalid.slice(0,8).map(e=>`${e.title} → ${dateLabel(relocateDate(e.date,before.calendar,nextCalendar).date,nextCalendar)}`).join('\n')}\n\nПрименить предложенный перенос?`:'Применить календарь для всех участников мира? Будет скачана резервная копия.';
      if(!window.confirm(message))return;
      this.downloadJSON(this.backupLocal('before-calendar-change'),`chronos-before-calendar-change-${Date.now()}.json`);
      const saved=await this.saveWorld(s=>{
        s.events=relocateEvents(s.events,before.calendar,nextCalendar);s.calendar=nextCalendar;
        s.date={...current.date,hour:before.date.hour,minute:before.date.minute};
      });
      if(saved){this.builderOpen=false;this.calendarDraft=null;this.render();}
    }
  },
  calendarClick(action,data){
    const handled=['calendar','close-calendar','month','calendar-day','calendar-add','edit-event','cancel-event','delete-event','toggle-event','add-note','edit-note','cancel-note','delete-note','builder','close-builder','add-month','remove-month','month-up','month-down','add-weekday','remove-weekday','export-calendar','import-calendar','export-personal','import-personal','backup','import-backup','export-local-backups'];
    if(!handled.includes(action))return false;
    const gmActions=['calendar-add','edit-event','cancel-event','delete-event','toggle-event','builder','close-builder','add-month','remove-month','month-up','month-down','add-weekday','remove-weekday','export-calendar','import-calendar','backup','import-backup'];
    if(gmActions.includes(action)&&!gm())return true;
    try{
      const {id,source,value}=data;
      if(action==='calendar'){this.calendarOpen=true;this.day=clone(this.state.date);this.viewMonth=clone(this.state.date);}
      if(action==='close-calendar')this.calendarOpen=false;
      if(action==='month')this.viewMonth=adjacentMonth(this.viewMonth,Number(value),this.state.calendar);
      if(action==='calendar-day'){this.day=parseDate(value);this.noteEdit=null;}
      if(action==='calendar-add'){this.managerOpen=true;this.tab='events';this.eventDate=clone(this.day);this.eventEdit=null;}
      if(action==='edit-event'){this.managerOpen=true;this.tab='events';this.eventEdit={id,source};}
      if(action==='cancel-event'){this.eventEdit=null;this.eventDate=null;}
      if(action==='delete-event'){
        if(!window.confirm('Удалить событие?'))return true;
        if(source==='public')void this.saveWorld(s=>{s.events=s.events.filter(x=>x.id!==id);});else this.updatePrivate(s=>{s.events=s.events.filter(x=>x.id!==id);});
      }
      if(action==='toggle-event'){
        const item=(source==='public'?this.state.events:this.secret.events).find(x=>x.id===id);if(!item)return true;
        const form=document.createElement('form');form.dataset.form='event';
        // Visibility changes use the same validated save path as editing.
        this.eventEdit={id,source};
        const d=parseDate(item.date,this.state.calendar);
        for(const [name,v] of Object.entries({title:item.title,year:d.year,month:d.month,day:d.day,time:item.time||'',note:item.note||'',color:color(item.color),...(item.annual?{annual:'on'}:{}),...(source==='private'?{visible:'on'}:{})})){
          const input=document.createElement('input');input.name=name;input.value=v;form.append(input);
        }
        void this.calendarSubmit(form).catch(report);return true;
      }
      if(action==='add-note'){this.noteEdit='new';this.eventDate=clone(this.day);}
      if(action==='edit-note'){this.noteEdit=id;}
      if(action==='cancel-note')this.noteEdit=null;
      if(action==='delete-note'&&window.confirm('Удалить личную запись?')){const next=this.personal.filter(x=>x.id!==id);localStorage.setItem(key('personal'),JSON.stringify(next));this.personal=next;this.noteEdit=null;}
      if(action==='builder'){this.openBuilder();return true;}
      if(action==='close-builder'){this.builderOpen=false;this.calendarDraft=null;}
      if(['add-month','remove-month','month-up','month-down','add-weekday','remove-weekday'].includes(action)){
        const d=this.readDraft(),i=d.months.findIndex(m=>m.id===id);
        if(action==='add-month'&&d.months.length<100)d.months.push({id:'m-'+uuid(),name:'Новый месяц',days:30});
        if(action==='remove-month'&&d.months.length>1){d.months.splice(i,1);if(d.yearStart===id)d.yearStart=d.months[0].id;}
        if(action==='month-up'&&i>0)[d.months[i-1],d.months[i]]=[d.months[i],d.months[i-1]];
        if(action==='month-down'&&i>=0&&i<d.months.length-1)[d.months[i+1],d.months[i]]=[d.months[i],d.months[i+1]];
        if(action==='add-weekday'&&d.weekdays.length<20)d.weekdays.push('Новый день');
        if(action==='remove-weekday'&&d.weekdays.length>1){d.weekdays.splice(Number(value),1);d.firstWeekday=Math.min(d.firstWeekday,d.weekdays.length-1);}
        this.renderBuilder();return true;
      }
      if(action==='export-calendar'){const calendar=calendarConfig(this.readDraft());this.downloadJSON({format:'chronos-calendar',version:1,calendar,year:this.draftYear},'chronos-calendar.json');}
      if(action==='import-calendar')this.requestImport('calendar');
      if(action==='export-personal')this.downloadJSON({format:'chronos-personal',version:1,calendar:this.state.calendar,events:this.personal},'chronos-personal.json');
      if(action==='import-personal')this.requestImport('personal');
      if(action==='backup')this.localBackup();
      if(action==='import-backup')this.requestImport('backup');
      if(action==='export-local-backups')this.downloadJSON({format:'chronos-local-backups',backups:JSON.parse(localStorage.getItem(key('backups'))||'[]')},'chronos-local-backups.json');
      this.render();
    }catch(err){report(err);}
    return true;
  }
};
