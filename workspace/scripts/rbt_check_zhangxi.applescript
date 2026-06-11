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
	set js1 to (do shell script "cat /Users/blacklake/hireclaw/workspace/scripts/check_zhangxi.js")
	set r1 to execute tab_ javascript js1
	delay 2
	set js2 to "(function(){var panel=document.querySelectorAll('*');var r='';for(var i=0;i<panel.length;i++){var t=panel[i].innerText;if(t.indexOf('简历')!=-1||t.indexOf('.pdf')!=-1||t.indexOf('附件')!=-1){if(t.length>5&&t.length<100){r+=t.substring(0,60)+'|';}}}return String(r.substring(0,300)||'no_resume_info');})()"
	set r2 to execute tab_ javascript js2
	return r1 & " | " & r2
end tell