(function(){
  var iframe=document.querySelector('iframe');
  var doc=iframe.contentDocument||iframe.contentWindow.document;
  var all=doc.querySelectorAll('*');
  var r=[];
  for(var i=0;i<all.length;i++){
    var h=all[i].offsetHeight;
    if(h<1){continue;}
    var t=all[i].innerText;
    if(t.indexOf('大模型算法工程师-工业智能')!=-1){
      r.push(i+':'+all[i].tagName+'|h='+h+'|t='+t.substring(0,50));
    }
  }
  return String(r.join('||')||'none');
})()