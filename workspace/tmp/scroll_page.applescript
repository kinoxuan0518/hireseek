tell application "Google Chrome"
	set resultText to execute tab 2 of window 1 javascript "var iframe=document.querySelector('iframe'); var doc=iframe.contentDocument||iframe.contentWindow.document; var container=doc.querySelector('.list-body')||doc.querySelector('[class*=list]')||doc.body; container.scrollTop=container.scrollHeight; String('scrolled_to_'+container.scrollHeight)"
	return resultText
end tell