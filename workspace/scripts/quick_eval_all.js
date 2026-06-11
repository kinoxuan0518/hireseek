(function(){
  var items=document.querySelectorAll('.geek-item');
  var r=[];
  for(var i=0;i<items.length;i++){
    var txt=items[i].innerText;
    var lines=txt.split('\n');
    var name=lines[0];
    if(txt.indexOf('.pdf')!=-1||txt.indexOf('.docx')!=-1){
      r.push(i+':'+name.trim()+'|'+txt.substring(0,120));
    }
  }
  return String(r.join('||'));
})()