(function(){
  var iframe=document.querySelector('iframe');
  var doc=iframe.contentDocument||iframe.contentWindow.document;
  var all=doc.querySelectorAll('*');
  var r=[];
  for(var i=0;i<all.length;i++){
    if(all[i].offsetHeight===0){continue;}
    var t=all[i].innerText;
    if(t&&t.length>5&&t.length<60&&t.indexOf('Agent')!=-1&&t.indexOf('上海')!=-1){
      r.push(all[i].tagName+'|'+t.substring(0,40));
    }
  }
  return String(r.join('||')||'none');
})()