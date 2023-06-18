class SourceCompositionIncluder
  def self.call(source)
    new(source:).call
  end

  def initialize(source:)
    @source = source
  end

  def call
    source.inclusions.each do |inclusion|
      if (comp = existing_composition_for(inclusion))
        inclusion.composition.mark_for_destruction
        inclusion.composition = comp
      else
        inclusion.composition.assign_attributes(
          composers: inclusion.attributions.map(&:refers_to),
          number_of_voices: inclusion.minimum_voice_count,
        )
      end
    end

    true
  end

  private

  attr_reader :source

  def existing_composition_for(inclusion)
    Composition
      .where.not(id: inclusion.composition.id)
      .joins(:composers)
      .find_by(
        composers: inclusion.attributions.map(&:refers_to) - [Composer.anon],
        composition_type: inclusion.composition.composition_type,
        even_odd: inclusion.composition.even_odd,
        number_of_voices: inclusion.minimum_voice_count,
        title: inclusion.composition.title,
        tone: inclusion.composition.tone,
      )
  end
end
