/** Calendar arithmetic uses integer days; custom dates never pass through JavaScript Date. */
const MONTH_NAMES=['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
export const EARTH_CALENDAR=Object.freeze({kind:'gregorian',name:'Земной календарь',era:'',months:MONTH_NAMES.map((name,i)=>({id:`m${i+1}`,name,days:[31,28,31,30,31,30,31,31,30,31,30,31][i]})),weekdays:['Пн','Вт','Ср','Чт','Пт','Сб','Вс'],firstWeekday:0,yearStart:'m1'});
const copy=x=>structuredClone(x);
const mod=(n,d)=>((n%d)+d)%d;
const text=(x,n)=>String(x??'').trim().slice(0,n);
export function calendarConfig(raw=EARTH_CALENDAR){
  if(!raw || !['gregorian','custom'].includes(raw.kind))throw new Error('Неизвестный тип календаря');
  const earth=raw.kind==='gregorian';
  if(!earth && (!Array.isArray(raw.months)||raw.months.length<1||raw.months.length>100))throw new Error('Нужно от 1 до 100 месяцев');
  const ids=new Set();
  const months=(earth?EARTH_CALENDAR.months:raw.months).map(m=>{
    if(!/^[a-zA-Z0-9_-]{1,80}$/.test(m.id)||ids.has(m.id))throw new Error('Некорректные или повторяющиеся идентификаторы месяцев');
    ids.add(m.id);
    if(!text(m.name,60)||!Number.isInteger(Number(m.days))||Number(m.days)<1||Number(m.days)>1000)throw new Error('Укажите название месяца и от 1 до 1000 дней');
    return {id:m.id,name:text(m.name,60),days:Number(m.days)};
  });
  const weekdays=raw.weekdays;
  if(!Array.isArray(weekdays)||weekdays.length<1||weekdays.length>20||weekdays.some(x=>!text(x,40)))throw new Error('В неделе должно быть от 1 до 20 названных дней');
  return {kind:raw.kind,name:text(raw.name,80)||'Мой календарь',era:text(raw.era,100),months,weekdays:weekdays.map(x=>text(x,40)),firstWeekday:mod(Math.trunc(Number(raw.firstWeekday)||0),weekdays.length),yearStart:ids.has(raw.yearStart)?raw.yearStart:months[0].id};
}
export function orderedMonths(c){const i=c.months.findIndex(m=>m.id===c.yearStart);return [...c.months.slice(i),...c.months.slice(0,i)];}
export const leapYear=y=>mod(y,4)===0 && (mod(y,100)!==0 || mod(y,400)===0);
export function monthDays(c,year,month){const m=c.months.find(x=>x.id===month);return m?(m.days+(c.kind==='gregorian'&&month==='m2'&&leapYear(year)?1:0)):0;}
export function parseDate(value,c=EARTH_CALENDAR){
  if(value && typeof value==='object')return {year:Number(value.year),month:String(value.month),day:Number(value.day)};
  if(typeof value==='string'){
    const key=/^(-?\d+)\|([a-zA-Z0-9_-]+)\|(\d+)$/.exec(value);
    if(key)return {year:Number(key[1]),month:key[2],day:Number(key[3])};
    const legacy=/^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if(legacy)return {year:Number(legacy[1]),month:EARTH_CALENDAR.months[Number(legacy[2])-1]?.id||'',day:Number(legacy[3])};
  }
  return {year:1,month:orderedMonths(c)[0].id,day:1};
}
export function validDate(d,c){return Number.isInteger(d.year)&&Math.abs(d.year)<=999999&&Number.isInteger(d.day)&&d.day>=1&&d.day<=monthDays(c,d.year,d.month);}
export function dateKey(d){return `${d.year}|${d.month}|${d.day}`;}
export function dateLabel(d,c){return `${d.day} ${c.months.find(x=>x.id===d.month)?.name||'—'}, ${d.year}${c.era?' '+c.era:''}`;}
export function clockLabel(d){return `${String(d.hour||0).padStart(2,'0')}:${String(d.minute||0).padStart(2,'0')}`;}
export function calendarDate(value,time,c){
  const d=parseDate(value,c);
  if(!validDate(d,c)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))throw new Error('Неверная дата или время календаря');
  const [hour,minute]=time.split(':').map(Number);return {...d,hour,minute};
}
export function yearDays(c,y){return c.months.reduce((sum,m)=>sum+monthDays(c,y,m.id),0);}
function beforeYear(c,y){const n=y-1;return c.kind==='gregorian'?365*n+Math.floor(n/4)-Math.floor(n/100)+Math.floor(n/400):n*yearDays(c,y);}
export function ordinal(d,c){
  if(!validDate(d,c))throw new Error('Дата вне календаря');
  let days=beforeYear(c,d.year)+d.day-1;
  for(const m of orderedMonths(c)){if(m.id===d.month)break;days+=monthDays(c,d.year,m.id);}return days;
}
export function fromOrdinal(n,c){
  if(!Number.isSafeInteger(n))throw new Error('Слишком большой интервал');
  let year=c.kind==='gregorian'?Math.floor(n/365.2425)+1:Math.floor(n/yearDays(c,1))+1;
  while(beforeYear(c,year)>n)year--;
  while(beforeYear(c,year+1)<=n)year++;
  let day=n-beforeYear(c,year);
  for(const m of orderedMonths(c)){const count=monthDays(c,year,m.id);if(day<count){const result={year,month:m.id,day:day+1};if(!validDate(result,c))throw new Error('Год вне поддерживаемого диапазона');return result;}day-=count;}
  throw new Error('Невозможно вычислить дату');
}
export function advanceDate(d,minutes,c){
  if(!Number.isSafeInteger(minutes))throw new Error('Неверный интервал');
  const total=(d.hour||0)*60+(d.minute||0)+minutes;
  const next=fromOrdinal(ordinal(d,c)+Math.floor(total/1440),c),clock=mod(total,1440);
  return {...next,hour:Math.floor(clock/60),minute:clock%60};
}
export function followingNight(d,time,c){const next=advanceDate(d,1440,c);return calendarDate(next,time,c);}
export function adjacentMonth(d,delta,c){
  const months=orderedMonths(c),i=months.findIndex(x=>x.id===d.month)+delta;
  const year=d.year+Math.floor(i/months.length),month=months[mod(i,months.length)].id;
  return {year,month,day:1};
}
export function weekday(d,c){return mod(ordinal(d,c),c.weekdays.length);}
export function eventOnDay(event,day,c){const d=parseDate(event.date,c);return d.month===day.month&&d.day===day.day&&(event.annual||d.year===day.year);}
export function eventsBetween(before,after,events,c){
  const a=ordinal(before,c)*1440+(before.hour||0)*60+(before.minute||0),b=ordinal(after,c)*1440+(after.hour||0)*60+(after.minute||0);
  if(b<=a)return [];
  return events.filter(event=>{
    const date=parseDate(event.date,c),[h,m]=(event.time||'00:00').split(':').map(Number);
    const reached=d=>validDate(d,c)&&a<ordinal(d,c)*1440+h*60+m&&ordinal(d,c)*1440+h*60+m<=b;
    if(!event.annual)return reached(date);
    // If a long jump covers more than one year, one complete intervening year is enough.
    const years=[before.year,after.year];if(after.year-before.year>1)for(let i=1;i<=8;i++)years.push(before.year+i);
    return years.some(year=>year<=after.year&&reached({...date,year}));
  });
}
export function relocateDate(value,oldCalendar,newCalendar){
  const old=parseDate(value,oldCalendar),oldMonths=orderedMonths(oldCalendar),newMonths=orderedMonths(newCalendar);
  const month=newCalendar.months.some(x=>x.id===old.month)?old.month:newMonths[Math.min(Math.max(0,oldMonths.findIndex(x=>x.id===old.month)),newMonths.length-1)].id;
  const date={year:Number.isInteger(old.year)?old.year:1,month,day:Math.max(1,Math.min(old.day||1,monthDays(newCalendar,old.year,month)))};
  return {date,changed:dateKey(old)!==dateKey(date)};
}
export function relocateEvents(events,oldCalendar,newCalendar){return events.map(event=>({...copy(event),date:relocateDate(event.date,oldCalendar,newCalendar).date}));}
export function cleanEvent(raw,c){
  if(!raw||typeof raw!=='object'||!text(raw.title,100))throw new Error('У записи должно быть название');
  const date=parseDate(raw.date,c);
  if(!validDate(date,c))throw new Error('Неверная дата записи');
  if(raw.time&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(raw.time))throw new Error('Неверное время записи');
  return {id:/^[a-zA-Z0-9_-]{1,100}$/.test(raw.id)?raw.id:crypto.randomUUID(),title:text(raw.title,100),note:text(raw.note,2000),date,time:raw.time||'',color:/^#[0-9a-f]{6}$/i.test(raw.color)?raw.color:'#b96b86',annual:!!raw.annual};
}
