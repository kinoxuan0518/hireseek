tell application "Google Chrome"
	set resultText to execute tab 2 of window 1 javascript "var iframe=document.querySelector('iframe'); var doc=iframe.contentDocument||iframe.contentWindow.document; var panel=doc.querySelector('.filter-panel'); var r='panel_exists'; if(!panel){r='panel_gone'}else{if(panel.offsetHeight<100){r='panel_collapsed'}else{r='panel_open_height_'+panel.offsetHeight}} String(r)"
	return resultText
end tell