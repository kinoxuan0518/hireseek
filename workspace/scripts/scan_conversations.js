(function(){
  var items=document.querySelectorAll('.geek-item');
  var r=[];
  for(var i=0;i<items.length;i++){
    var txt=items[i].innerText;
    var lines=txt.split('\n');
    var name=lines[0]||'unknown';
    var status='';
    if(txt.indexOf('[已读]')!=-1)status='[已读]';
    else if(txt.indexOf('[送达]')!=-1)status='[送达]';
    var recent=txt.substring(txt.length-80);
    r.push(i+':'+name.trim()+'|'+status+'|...'+recent.trim());
  }
  return String(r.join('||'));
})()