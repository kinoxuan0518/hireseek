on run argv
	set targetName to item 1 of argv
	
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
		
		-- Step 1: Click candidate
		set js1 to "(function(){var items=document.querySelectorAll('.geek-item');for(var i=0;i<items.length;i++){if(items[i].innerText.indexOf('" & targetName & "')!=-1){items[i].click();return 'clicked';}}return 'not_found';})()"
		set r1 to execute tab_ javascript js1
		delay 2
		
		-- Step 2: Remove old resume panel and click attachment
		set js2 to "(function(){var rc=document.querySelector('.resume-content');if(rc)rc.remove();var btns=document.querySelectorAll('button,div,span');for(var i=0;i<btns.length;i++){var t=btns[i].innerText;if((t.indexOf('附件')!=-1||t.indexOf('简历')!=-1)&&btns[i].offsetHeight>0&&t.length<10&&btns[i].tagName==='BUTTON'){btns[i].click();return 'clicked_attachment';}}return 'no_attachment_btn';})()"
		set r2 to execute tab_ javascript js2
		delay 3
		
		-- Step 3: Read resume iframe content
		set js3 to "(function(){var f=document.querySelector('.attachment-iframe');if(!f){return 'no_iframe';}var doc=f.contentDocument;if(!doc){return 'no_iframe_doc';}var tl=doc.querySelector('.textLayer');if(!tl){return doc.body.innerText.substring(0,500)||'no_textLayer';}var spans=tl.querySelectorAll('span');var r='';for(var i=0;i<spans.length;i++){var t=spans[i].textContent.trim();if(t)r+=t+' ';}return r.substring(0,2000)||'empty_spans';})()"
		set r3 to execute tab_ javascript js3
		
		return r1 & "||att:" & r2 & "||text:" & r3
	end tell
end run