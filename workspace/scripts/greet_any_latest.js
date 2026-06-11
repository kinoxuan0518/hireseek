(function(){
  var iframe=document.querySelector('iframe');
  var doc=iframe.contentDocument||iframe.contentWindow.document;
  var ul=doc.querySelector('ul.recommend-card-list');
  if(!ul){return 'no_ul';}
  var lis=ul.querySelectorAll('li');
  var r=[];
  for(var i=0;i<lis.length;i++){
    var txt=lis[i].innerText;
    var btn=lis[i].querySelector('.btn-greet');
    if(!btn){continue;}
    var is27=txt.indexOf('27年')!=-1||txt.indexOf('28年')!=-1;
    if(is27){continue;}
    var has=txt.indexOf('Agent')!=-1||txt.indexOf('agent')!=-1||txt.indexOf('LLM')!=-1||txt.indexOf('大模型')!=-1||txt.indexOf('RAG')!=-1||txt.indexOf('LangChain')!=-1;
    var has985=txt.indexOf('浙大')!=-1||txt.indexOf('东南')!=-1||txt.indexOf('华中科技')!=-1;
    var hasQS=txt.indexOf('滑铁卢')!=-1||txt.indexOf('香港')!=-1||txt.indexOf('新加坡')!=-1||txt.indexOf('加州')!=-1||txt.indexOf('布朗')!=-1||txt.indexOf('多伦多')!=-1||txt.indexOf('UBC')!=-1||txt.indexOf('卡内基')!=-1||txt.indexOf('纽约')!=-1||txt.indexOf('波士顿')!=-1||txt.indexOf('密歇根')!=-1;
    if(has||has985||hasQS){
      btn.scrollIntoView();
      btn.click();
      return String('greeted_latest_'+i);
    }
  }
  return 'none';
})()