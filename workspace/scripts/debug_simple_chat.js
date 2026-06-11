(function(){
  var msgs=document.querySelectorAll('.geek-item,.chat-msg,.msg-item,.file-item');
  var parts=[];
  for(var i=0;i<msgs.length;i++){
    var t=msgs[i].innerText;
    if(t.indexOf('.pdf')!=-1||t.indexOf('.docx')!=-1){
      parts.push(i+':'+t.substring(0,60));
    }
  }
  return parts.length>0?parts.join('||'):'no_pdf_found';
})()