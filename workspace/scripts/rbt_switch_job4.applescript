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
	
	-- Read JS from file and execute
	set jsFile to (do shell script "cat /Users/blacklake/hireclaw/workspace/scripts/trigger_job_dropdown.js")
	set r to execute tab_ javascript jsFile
	delay 1
	
	set jsFile2 to (do shell script "cat /Users/blacklake/hireclaw/workspace/scripts/click_bigmodel_job.js")
	set r2 to execute tab_ javascript jsFile2
	delay 2
	
	return r & " | " & r2
end tell