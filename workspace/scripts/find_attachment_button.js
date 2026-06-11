(function(){
  var all=document.querySelectorAll('*');
  var r=[];
  for(var i=0;i<all.length;i++){
    if(all[i].offsetHeight<1){continue;}
    var t=all[i].innerText;
    var cls=String(all[i].className);
    if(t.indexOf('附件')!=-1||t.indexOf('简历')!=-1||cls.indexOf('resume')!=-1||cls.indexOf('file')!=-1){
      if(t.length<20){
        r.push(all[i].tagName+'|cls='+cls.substring(0,20)+'|txt='+t.substring(0,15));
      }
    }
  }
  return String(r.join('||')||'none');
})()