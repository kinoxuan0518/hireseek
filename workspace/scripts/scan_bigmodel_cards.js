(function(){
  var iframe=document.querySelector('iframe');
  var doc=iframe.contentDocument||iframe.contentWindow.document;
  var cards=doc.querySelectorAll('.card-item');
  if(cards.length===0){
    var ul=doc.querySelector('ul.recommend-card-list');
    if(ul){cards=ul.querySelectorAll('li');}
  }
  var r=[];
  for(var i=0;i<cards.length;i++){
    var txt=cards[i].innerText;
    var btn=cards[i].querySelector('.btn-greet');
    if(!btn){continue;}
    var name=txt.split('\n')[1]||txt.split('\n')[0];
    var hasA=txt.indexOf('Agent')!=-1||txt.indexOf('agent')!=-1||txt.indexOf('LLM')!=-1||txt.indexOf('大模型')!=-1||txt.indexOf('RAG')!=-1;
    var is27=txt.indexOf('27年')!=-1||txt.indexOf('28年')!=-1;
    var has985=txt.indexOf('浙大')!=-1||txt.indexOf('清华')!=-1||txt.indexOf('北大')!=-1||txt.indexOf('复旦')!=-1||txt.indexOf('上海交大')!=-1||txt.indexOf('哈工')!=-1||txt.indexOf('北理工')!=-1||txt.indexOf('电子科大')!=-1;
    var hasQS=txt.indexOf('滑铁卢')!=-1||txt.indexOf('香港')!=-1||txt.indexOf('新加坡')!=-1||txt.indexOf('加州')!=-1||txt.indexOf('布朗')!=-1||txt.indexOf('卡内基')!=-1||txt.indexOf('密歇根')!=-1||txt.indexOf('多伦多')!=-1;
    if((hasA||has985||hasQS)&&!is27){
      r.push(i+':'+name.trim()+'|A='+(hasA?'Y':'N')+'|985='+(has985?'Y':'N')+'|QS='+(hasQS?'Y':'N'));
    }
  }
  return String(r.join('||')||'none');
})()