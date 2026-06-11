tell application "Google Chrome"
	set resultText to execute tab 2 of window 1 javascript "var iframe=document.querySelector('iframe'); var doc=iframe.contentDocument||iframe.contentWindow.document; var btns=doc.querySelectorAll('.btn'); for(var i=0;i<btns.length;i++){if(btns[i].innerText.trim()=='确认'){btns[i].click();String('confirmed')}} String('notfound')"
	return resultText
end tell