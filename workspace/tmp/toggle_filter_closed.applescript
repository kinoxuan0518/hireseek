tell application "Google Chrome"
	set resultText to execute tab 2 of window 1 javascript "var iframe=document.querySelector('iframe'); var doc=iframe.contentDocument||iframe.contentWindow.document; var fl=doc.querySelector('.filter-label'); var r='not_found'; if(fl){fl.click();r='clicked'} String(r)"
	return resultText
end tell