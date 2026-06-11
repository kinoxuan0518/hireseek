(function(){
  var items=document.querySelectorAll('.geek-item');
  var r=[];
  for(var i=0;i<items.length;i++){
    var txt=items[i].innerText;
    var lines=txt.split('\n');
    var name=lines[0]||'unk';
    var urgent=false;
    var reason='';
    if(txt.indexOf('发送附件简历')!=-1){urgent=true;reason='需同意收简历';}
    if(txt.indexOf('可以聊')!=-1||txt.indexOf('可以的')!=-1||txt.indexOf('感兴趣')!=-1||txt.indexOf('聊聊')!=-1){urgent=true;reason='有意向回复';}
    if(txt.indexOf('发一份简历')!=-1||txt.indexOf('.pdf')!=-1||txt.indexOf('.docx')!=-1){urgent=true;reason='有简历';}
    if(urgent){
      r.push(i+':'+name.trim()+'|'+reason+'|'+txt.substring(txt.length-60,txt.length));
    }
  }
  return String(r.join('||')||'none');
})()