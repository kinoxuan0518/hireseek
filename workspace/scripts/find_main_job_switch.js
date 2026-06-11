(function(){
  var items=document.querySelectorAll('A,SPAN,DIV');
  var r=[];
  for(var i=0;i<items.length;i++){
    try{
      if(items[i].offsetHeight===0){continue;}
      var t=items[i].innerText;
      if(t.indexOf('Agent 开发工程师')!=-1&&t.length<60){
        r.push(i+':'+items[i].tagName+'|'+t.substring(0,40));
        if(r.length>5){break;}
      }
    }catch(e){}
  }
  return String(r.join('||')||'none');
})()