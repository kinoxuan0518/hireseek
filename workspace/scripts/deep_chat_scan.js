(function(){
  var all=document.querySelectorAll('*');
  var r=[];
  for(var i=0;i<all.length;i++){
    var h=all[i].offsetHeight;
    if(h<1||h>50){continue;}
    var t=all[i].innerText;
    if(t.indexOf('.pdf')!=-1||t.indexOf('.docx')!=-1||t.indexOf('闫可菁_简历')!=-1){
      r.push(i+':'+all[i].tagName+'|h='+h+'|t='+t.substring(0,40)+'|cls='+String(all[i].className).substring(0,20));
    }
  }
  return String(r.join('||')||'none');
})()