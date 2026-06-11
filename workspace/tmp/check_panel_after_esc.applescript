tell application "Google Chrome"
	set resultText to execute tab 2 of window 1 javascript "var iframe=document.querySelector('iframe'); var doc=iframe.contentDocument||iframe.contentWindow.document; var panel=doc.querySelector('.filter-panel'); var r='gone'; if(panel){r='exists_height_'+panel.offsetHeight} String(r)"
	return resultText
end tell