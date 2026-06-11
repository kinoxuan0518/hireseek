(function(){
  var iframe=document.querySelector('iframe');
  var doc=iframe.contentDocument||iframe.contentWindow.document;
  var all=doc.querySelectorAll('*');
  var r=[];
  for(var i=0;i<all.length;i++){
    if(all[i].offsetHeight<1){continue;}
    var t=all[i].innerText;
    if(t.indexOf('Agent 开发工程师')!=-1&&t.length<80){
      r.push(all[i].tagName+'|cls='+String(all[i].className).substring(0,30)+'|'+t.substring(0,50));
    }
  }
  return String(r.join('||')||'none');
})()