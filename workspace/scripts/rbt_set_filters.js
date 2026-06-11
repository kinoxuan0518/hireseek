(function(){
  var iframe=document.querySelector('iframe');
  if(!iframe) return 'no_iframe';
  var doc=iframe.contentDocument||iframe.contentWindow.document;
  
  // Click 取消 on recover prompt if present
  var cancelBtns=doc.querySelectorAll('div');
  for(var i=0;i<cancelBtns.length;i++){
    if(cancelBtns[i].innerText.trim()==='取消'&&cancelBtns[i].offsetHeight>0){
      cancelBtns[i].click();
      break;
    }
  }
  
  return 'cancel_done';
})()
