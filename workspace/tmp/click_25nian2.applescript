tell application "Google Chrome"
	set resultText to execute tab 2 of window 1 javascript "var iframe=document.querySelector('iframe'); var doc=iframe.contentDocument||iframe.contentWindow.document; var opts=doc.querySelectorAll('.option'); for(var i=0;i<opts.length;i++){if(opts[i].innerText.trim()=='25年毕业'){opts[i].click();String('clicked')}} String('notfound')"
	return resultText
end tell