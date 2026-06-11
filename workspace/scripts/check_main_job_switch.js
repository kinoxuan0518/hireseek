(function(){
  var items=document.querySelectorAll('A,DIV,SPAN');
  var r=[];
  for(var i=0;i<items.length;i++){
    var t=items[i].innerText;
    if(t.indexOf('推荐牛人')!=-1||t.indexOf('职位管理')!=-1||t.indexOf('大模型')!=-1){
      if(items[i].offsetHeight>0){
        r.push(i+':'+items[i].tagName+'|'+t.substring(0,40));
      }
    }
  }
  return String(r.join('||')||'none');
})()