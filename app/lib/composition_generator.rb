class CompositionGenerator
  def self.run
    to_check_composer = Composer.find_or_create_by!(name: "to check")
    anon_composer = Composer.find_by!(name: "Anon")

    UniquePiece.all.order(:id).each do |unique_piece|
      title = Title.find_or_create_by!(text: unique_piece.title)
      number_of_voices = unique_piece.minimum_voices

      composers = unique_piece.inclusions.flat_map(&:attributions).map {|a|
        if a.incorrectly_attributed?
          to_check_composer
        elsif a.alias.nil?
          anon_composer
        else
          a.alias.composer
        end
      }.uniq

      composition = Composition.where(
        number_of_voices: number_of_voices,
        title: title,
      ).find { |c| c.composers.to_set == composers.to_set }

      if composition
        puts "Updating composition `#{title.text}`"
      else
        puts "Creating new composition `#{title.text}`"
        composition = Composition.new(
          number_of_voices: number_of_voices,
          title: title,
        )
      end

      composition.composers = composers
      composition.inclusions = unique_piece.inclusions

      composition.save!
    end
  end
end
