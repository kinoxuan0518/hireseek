(function(){
  var all=document.querySelectorAll('*');
  var r=[];
  for(var i=0;i<all.length;i++){
    var t=all[i].innerText;
    var h=all[i].offsetHeight;
    if(h<1){continue;}
    if(t.indexOf('下载')!=-1||t.indexOf('附件简历')!=-1||t.indexOf('.pdf')!=-1){
      r.push(i+':'+all[i].tagName+'|h='+h+'|cls='+String(all[i].className).substring(0,15)+'|t='+t.substring(0,30));
    }
  }
  return String(r.join('||')||'none');
})()