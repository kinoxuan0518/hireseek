(function(){
  var rc=document.querySelector('.resume-content');
  if(rc) rc.remove();
  
  var btns=document.querySelectorAll('.resume-btn-file,.btn-file,[class*=resume] button');
  for(var i=0;i<btns.length;i++){
    if(btns[i].offsetHeight>0&&btns[i].innerText.indexOf('附件')!=-1){
      btns[i].click();
      break;
    }
  }
  return 'clicked_attachment_btn';
})()