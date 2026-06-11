(function(){
  var all=document.querySelectorAll('*');
  var r=[];
  for(var i=0;i<all.length;i++){
    var h=all[i].offsetHeight;
    if(h<1||h>100){continue;}
    var t=all[i].innerText;
    if(t.length<2||t.length>30){continue;}
    if(t.indexOf('附件')!=-1||t.indexOf('简历')!=-1||t.indexOf('下载')!=-1||t.indexOf('文件')!=-1||t.indexOf('.pdf')!=-1){
      r.push(i+':'+all[i].tagName+'|h='+h+'|t='+t);
    }
  }
  return String(r.join('||')||'none');
})()