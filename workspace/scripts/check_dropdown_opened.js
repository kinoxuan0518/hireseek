(function(){
  var iframe=document.querySelector('iframe');
  var doc=iframe.contentDocument||iframe.contentWindow.document;
  var lis=doc.querySelectorAll('LI');
  var r=[];
  for(var i=0;i<lis.length;i++){
    var h=lis[i].offsetHeight;
    if(h<1){continue;}
    var t=lis[i].innerText;
    if(t.length>10&&t.length<60){
      r.push(i+':'+t.substring(0,40)+'|h='+h);
    }
  }
  return String(r.join('||')||'none');
})()