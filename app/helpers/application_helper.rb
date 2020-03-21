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
    classes = ["clef-image"]

    classes << "optional" if clef.optional?

    @both_ids ||= inclusion.both_clef_ids.to_a.dup
    @incomplete_ids ||= inclusion.incomplete_clef_ids.to_a.dup
    @missing_ids ||= inclusion.missing_clef_ids.to_a.dup

    if @both_ids.include?(clef.id)
      classes += ["missing", "incomplete"]
      @both_ids.delete_at(@both_ids.index(clef.id))
    elsif @incomplete_ids.include?(clef.id)
      classes << "incomplete"
      @incomplete_ids.delete_at(@incomplete_ids.index(clef.id))
    elsif @missing_ids.include?(clef.id)
      classes << "missing"
      @missing_ids.delete_at(@missing_ids.index(clef.id))
    end

    classes.join(" ")
  end

  def anon_composer
    @anon_composer ||= Composer.find_by!(name: "Anon")
  end
end
