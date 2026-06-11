(function(){
  var iframe=document.querySelector('iframe');
  var doc=iframe.contentDocument||iframe.contentWindow.document;
  var cards=doc.querySelectorAll('.card-item');
  var r=[];
  for(var i=0;i<cards.length;i++){
    var txt=cards[i].innerText;
    if(txt.indexOf('btn-greet')<0&&!cards[i].querySelector('.btn-greet')){continue;}
    var lines=txt.split('\n');
    var name=lines[1]||lines[0];
    var hasAgent=txt.indexOf('Agent')!=-1||txt.indexOf('agent')!=-1||txt.indexOf('LLM')!=-1||txt.indexOf('大模型')!=-1||txt.indexOf('RAG')!=-1;
    var is27=txt.indexOf('27年')!=-1||txt.indexOf('28年')!=-1;
    if((hasAgent||txt.indexOf('滑铁卢')!=-1||txt.indexOf('香港')!=-1||txt.indexOf('浙大')!=-1)&&!is27){
      r.push(i+':'+name.trim()+'|agent='+(hasAgent?'Y':'N')+'|txt='+txt.substring(0,60));
    }
  }
  return String(r.join('||')||'none');
})()