(function(){
  var cards=document.querySelector('iframe').contentDocument.querySelectorAll('.card-item');
  var r=[];
  for(var i=0;i<cards.length;i++){
    var txt=cards[i].innerText;
    var btn=cards[i].querySelector('.btn-greet');
    if(!btn){continue;}
    var is27=txt.indexOf('27年')!=-1||txt.indexOf('28年')!=-1;
    if(is27){continue;}
    var has=txt.indexOf('Agent')!=-1||txt.indexOf('agent')!=-1||txt.indexOf('LLM')!=-1||txt.indexOf('大模型')!=-1||txt.indexOf('RAG')!=-1||txt.indexOf('LangChain')!=-1;
    if(!has){continue;}
    btn.scrollIntoView();
    btn.click();
    return String('greeted_'+i);
  }
  return 'none';
})()