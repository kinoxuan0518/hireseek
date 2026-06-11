(function(){
  var panel=document.querySelector('.base-info-single-container');
  if(!panel){return 'no_panel';}
  return String(panel.innerText.substring(0,600));
})()