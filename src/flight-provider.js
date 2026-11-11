/* DEMO data adapter. Replace only the authorized server-side provider boundary
 * when AOT supplies its schema and credentials. Never put API keys in this file.
 */
(function(global){
  'use strict';
  const MINUTE=60000;
  const templates=[
    ['F101','DEMO-101','Sample Air','Singapore','SIN',-118,0,-108,'LANDED','07'],
    ['F202','DEMO-202','Example Airways','Tokyo / Haneda','HND',-47,0,-34,'LANDED','11'],
    ['F303','DEMO-303','Sample Air','Kuala Lumpur','KUL',19,64,null,'DELAYED','TBA'],
    ['F404','DEMO-404','Concept Airlines','Seoul / Incheon','ICN',38,0,null,'ON_TIME','TBA'],
    ['F505','DEMO-505','Example Airways','Paris','CDG',77,95,null,'DELAYED','TBA'],
    ['F606','DEMO-606','Sample Air','Hong Kong','HKG',99,0,null,'ON_TIME','TBA'],
    ['F707','DEMO-707','Concept Airlines','Doha','DOH',126,0,null,'CANCELLED','—'],
    ['F808','DEMO-808','Example Airways','Chiang Mai','CNX',148,0,null,'ON_TIME','TBA'],
    ['F909','DEMO-909','Sample Air','Phuket','HKT',174,35,null,'DELAYED','TBA'],
    ['F110','DEMO-110','Concept Airlines','London / Heathrow','LHR',205,0,null,'ON_TIME','TBA'],
    ['F120','DEMO-120','Example Airways','Manila','MNL',242,0,null,'ON_TIME','TBA'],
    ['F130','DEMO-130','Sample Air','Osaka / Kansai','KIX',279,25,null,'DELAYED','TBA']
  ];
  function list(){
    const data=global.ANPRStore.snapshot(),base=data.flightSeedAt;
    return templates.map(t=>{
      const at=n=>new Date(base+n*MINUTE).toISOString();
      const f={id:t[0],flightNo:t[1],airline:t[2],origin:t[3],originCode:t[4],scheduledAt:at(t[5]),estimatedAt:t[8]==='CANCELLED'?null:at(t[5]+t[6]),actualAt:t[7]===null?null:at(t[7]),status:t[8],belt:t[9],terminal:'MAIN',source:'DEMO',updatedAt:new Date(base).toISOString()};
      const o=data.flightOverrides[f.id];
      if(o){
        f.updatedAt=o.at;f.actualAt=null;
        if(o.scenario==='cancelled'){f.status='CANCELLED';f.estimatedAt=null;f.belt='—';}
        else if(o.scenario==='landed'){f.status='LANDED';f.actualAt=o.at;f.estimatedAt=o.at;}
        else {const delay=o.scenario==='delay60'?60:o.scenario==='delay120'?120:0;f.status=delay?'DELAYED':'ON_TIME';f.estimatedAt=new Date(Date.parse(f.scheduledAt)+delay*MINUTE).toISOString();}
      }
      return f;
    });
  }
  function delayMinutes(f){
    if(!f||f.status==='CANCELLED')return 0;
    const ms=Date.parse(f.actualAt||f.estimatedAt)-Date.parse(f.scheduledAt);
    return Number.isFinite(ms)?Math.max(0,Math.round(ms/MINUTE)):0;
  }
  function bounded(value,fallback,min,max){
    const n=value===undefined||value===null||value===''?fallback:Number(value);
    return Math.min(max,Math.max(min,Number.isFinite(n)?n:fallback));
  }
  function planPickup(f,options={}){
    if(!f||f.status==='CANCELLED')return null;
    const arrival=f.actualAt||f.estimatedAt||f.scheduledAt,ms=Date.parse(arrival);
    if(!Number.isFinite(ms))return null;
    const travelMinutes=bounded(options.travelMinutes,60,1,300),passengerProcessingMinutes=bounded(options.passengerProcessingMinutes,50,0,240),arrivalBufferMinutes=bounded(options.arrivalBufferMinutes,10,0,120);
    const meeting=ms+passengerProcessingMinutes*MINUTE,depart=meeting-(travelMinutes+arrivalBufferMinutes)*MINUTE;
    return {flightArrivalAt:arrival,meetingAt:new Date(meeting).toISOString(),departAt:new Date(depart).toISOString(),travelMinutes,passengerProcessingMinutes,arrivalBufferMinutes};
  }
  global.FlightProvider=Object.freeze({mode:'demo',officialUrl:'https://suvarnabhumi.airportthai.co.th/flight?type=arrivals',list,getArrivals:async()=>list(),delayMinutes,planPickup,
    get lastUpdatedAt(){const s=global.ANPRStore.snapshot();return Object.values(s.flightOverrides).map(o=>o.at).sort().at(-1)||new Date(s.flightSeedAt).toISOString();}
  });
})(window);
