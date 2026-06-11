tell application "Google Chrome"
	set tab_ to null
	repeat with w from 1 to count of windows
		repeat with t from 1 to count of tabs of window w
			if URL of tab t of window w contains "zhipin.com/web/chat" then
				set tab_ to tab t of window w
				exit repeat
			end if
		end repeat
		if tab_ is not null then exit repeat
	end repeat
	set js to "(function(){var iframe=document.querySelector('iframe');var doc=iframe.contentDocument||iframe.contentWindow.document;var label=doc.querySelector('.filter-label');if(!label){return 'no_label';}label.click();return 'clicked';})()"
	set r to execute tab_ javascript js
	delay 1
	set js2 to "(function(){var iframe=document.querySelector('iframe');var doc=iframe.contentDocument||iframe.contentWindow.document;var wrap=doc.querySelector('.filter-wrap');if(!wrap){return 'no_wrap';}var isOpen=wrap.offsetHeight>100;return 'open='+isOpen;})()"
	set r2 to execute tab_ javascript js2
	return r & ' ' & r2
end tell
