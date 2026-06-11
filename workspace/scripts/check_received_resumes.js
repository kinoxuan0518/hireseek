(function(){
  var items=document.querySelectorAll('.geek-item');
  var r=[];
  for(var i=0;i<items.length;i++){
    var txt=items[i].innerText;
    var lines=txt.split('\n');
    var name=lines[0];
    var hasPDF=txt.indexOf('.pdf')!=-1||txt.indexOf('.docx')!=-1||txt.indexOf('.doc')!=-1;
    var hasResumeReq=txt.indexOf('发送附件简历')!=-1||txt.indexOf('发一份简历')!=-1;
    var hasResumeMsg=txt.indexOf('简历')!=-1;
    if(hasPDF||hasResumeReq||hasResumeMsg){
      r.push(i+':'+name.trim()+'|pdf='+(hasPDF?'Y':'N')+'|req='+(hasResumeReq?'Y':'N'));
    }
  }
  return String(r.join('||'));
})()