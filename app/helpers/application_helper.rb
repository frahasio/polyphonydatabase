module ApplicationHelper
  def profile
    RubyProf.start

    yield

    result = RubyProf.stop

    file = File.open("profile.html", "w")
    RubyProf::CallStackPrinter.new(result).print(file)
    file.close
  end

  def clefs_and_classes(inclusion)
    inclusion.clef_inclusions.sort_by(&:sort_value).map do |ci|
      [
        clefs_for_image(ci),
        classes_for_image(ci),
      ]
    end
  end

  def clefs_for_image(ci)
    [ci.clef, *ci.transitions_to].compact_blank.join
  end

  def classes_for_image(ci)
    [
      "clef-image",
      ("optional" if ci.optional?),
      ("missing" if ci.missing?),
      ("incomplete" if ci.incomplete?)
    ].compact.join(" ")
  end

  def anon_composer
    @anon_composer ||= Composer.find_by!(name: "Anon")
  end
end
