(function(){
  var f=document.querySelector('.attachment-iframe');
  if(!f){return 'no_iframe';}
  var doc=f.contentDocument;
  if(!doc){return 'no_doc';}
  var body=doc.body.innerText;
  if(body&&body.length>100){return body.substring(0,3000);}
  var tl=doc.querySelector('.textLayer');
  if(!tl){return 'no_textLayer_body='+body.length;}
  var spans=tl.querySelectorAll('span');
  var r=[];
  for(var i=0;i<spans.length;i++){
    var t=spans[i].textContent.trim();
    if(t){r.push(t);}
  }
  if(r.length>0){return r.join(' ').substring(0,3000);}
  var spans2=tl.querySelectorAll('*');
  var r2=[];
  for(var i=0;i<spans2.length;i++){
    var t=spans2[i].textContent.trim();
    if(t&&t.length>2){r2.push(t);}
  }
  return r2.join(' ').substring(0,3000)||'empty';
})()