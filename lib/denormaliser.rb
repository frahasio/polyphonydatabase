module Denormaliser
  def self.run
    Inclusion.all.each do |inclusion|
      # Store position in source
      inclusion.source.inclusions.order(:order).each_with_index do |inc, index|
        if inclusion == inc
          inclusion.position = index + 1
          break
        end
      end

      # Store public-formatted notes
      special_attribs = inclusion.attributions.where(incorrectly_attributed: true).to_a
      special_attribs += inclusion.attributions.select {|a| a.resolved_composer.blank? }

      inclusion.public_notes = if special_attribs.any?
        [%[#{special_attribs.map {|a| "Attrib: #{a.anonym_name || "Anon."}"}.join("; ")}], inclusion.notes].reject(&:blank?).join("; ")
      else
        inclusion.notes
      end

      inclusion.save!
    end

    # Update denormalised source fields
    Source.all.each do |source|
      source.update(
        from_year: source.from_year,
        town: source.town,
      )
    end

    # Update denormalised unique piece fields
    UniquePiece.all.each do |unique_piece|
      unique_piece.update(
        feasts: unique_piece.feasts,
      )
    end

    grouped_inclusions.each do |unique_piece, info|
      unique_piece.update(
        has_edition: unique_piece.editions.any?,
        has_recording: unique_piece.recordings.any?,
        composers: info[:composers],
        inclusions: info[:inclusions],
      )
    end

    UniquePiece.where.not(id: grouped_inclusions.keys.map(&:id)).delete_all
  end

  def self.grouped_inclusions
    Inclusion.all.each_with_object({}) do |inclusion, hash|
      title = inclusion&.piece&.title
      composers = inclusion.composers.compact
      composer_list = composers.map(&:id).sort.join(",")
      minimum_voices = inclusion.minimum_voice_count

      unique_piece = UniquePiece.find_or_initialize_by(
        title: title,
        composer_list: composer_list,
        minimum_voices: minimum_voices,
      )

      hash[unique_piece] ||= {
        composers: composers,
        inclusions: [],
      }

      hash[unique_piece][:inclusions] << inclusion
    end
  end
end
