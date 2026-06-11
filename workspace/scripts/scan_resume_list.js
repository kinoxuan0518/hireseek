(function(){
  var items=document.querySelectorAll('.geek-item');
  var r=[];
  for(var i=0;i<items.length;i++){
    var txt=items[i].innerText;
    var lines=txt.split('\n');
    var name=lines[0];
    var hasDoc=txt.indexOf('.pdf')!=-1||txt.indexOf('.docx')!=-1||txt.indexOf('简历')!=-1;
    r.push(i+':'+name.trim()+'|has_doc='+(hasDoc?'Y':'N')+'|txt='+txt.substring(0,60));
  }
  return String(r.join('||'));
})()