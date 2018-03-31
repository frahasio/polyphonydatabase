module ApplicationHelper
  def profile
    RubyProf.start

    yield

    result = RubyProf.stop

    file = File.open("profile.html", "w")
    RubyProf::CallStackPrinter.new(result).print(file)
    file.close
  end
end
