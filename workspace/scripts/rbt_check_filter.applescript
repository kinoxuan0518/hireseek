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
	set js to "(function(){var iframe=document.querySelector('iframe');if(!iframe){return 'no_iframe';}var doc=iframe.contentDocument||iframe.contentWindow.document;var text=doc.body.innerText;var hasFilter=text.indexOf('筛选')>=0?'has_filter':'no_filter';var hasSkillQuestion=text.indexOf('需要应聘者')>=0?'has_skill_q':'no_skill_q';return hasFilter+'|'+hasSkillQuestion+'|'+text.substring(0,100);})()"
	set r to execute tab_ javascript js
	return r
end tell
