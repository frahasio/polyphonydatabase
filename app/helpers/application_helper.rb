module ApplicationHelper
  def profile
    RubyProf.start

    yield

    result = RubyProf.stop

    file = File.open("profile.html", "w")
    RubyProf::CallStackPrinter.new(result).print(file)
    file.close
  end

  def note_for_image(clef, inclusion)
    [clef.note, inclusion.transitions_to[clef.id.to_s]].compact.join
  end

  def classes_for_image(clef, inclusion)
    [
      "clef-image",
      ("missing" if inclusion.missing_clef_ids.include?(clef.id)),
      ("incomplete" if inclusion.incomplete_clef_ids.include?(clef.id)),
      ("optional" if clef.optional?),
      ("transitional" unless inclusion.transitions_to[clef.id.to_s].blank?),
    ].compact.join(" ")
  end

  def anon_composer
    @anon_composer ||= Composer.find_by!(name: "Anon")
  end
end
