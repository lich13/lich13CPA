set scriptPath to POSIX path of (path to resource "fix_and_open.sh")

try
  do shell script quoted form of scriptPath
on error errText number errNum
  display dialog errText buttons {"OK"} default button "OK" with icon caution
end try
