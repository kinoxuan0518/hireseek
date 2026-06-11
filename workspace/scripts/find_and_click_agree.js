(function(){
  var items=document.querySelectorAll('.geek-item');
  var r=[];
  for(var i=0;i<items.length;i++){
    var txt=items[i].innerText;
    if(txt.indexOf('发送附件简历')!=-1||txt.indexOf('附件简历给您')!=-1){
      var name=txt.split('\n')[0];
      r.push(i+':'+name.trim());
    }
  }
  return String(r.join('||')||'none');
})()