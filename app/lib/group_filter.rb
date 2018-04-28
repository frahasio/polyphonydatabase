class GroupFilter
  def self.filter(params)
    self.new(params).filter
  end

  def initialize(params)
    @params = params
  end

  def filter
    groups = Group.select("distinct on(groups.id) groups.*")
    groups = function(groups)
    groups = composer(groups)
    groups = composer_country(groups)
    groups = voices(groups)
    groups = voicing(groups)
    groups = source(groups)
    groups = has_edition?(groups)
    groups = has_recording?(groups)
    groups = search(groups)
    groups = Group.from("(#{groups.to_sql}) as groups")

    groups
  end

private

  attr_reader :params

  def search(groups)
    return groups if params[:q].blank?

    joined_groups = groups.left_outer_joins(
      composers: [
        aliases: :anonym,
      ],
      compositions: [
        :title,
        inclusions: :source,
      ],
      editions: [
        :editor,
      ],
      recordings: [
        :performer,
      ],
    )

    joined_groups.where("groups.display_title ILIKE ?", "%#{params[:q]}%")
      .or(joined_groups.where("titles.text ILIKE ?", "%#{params[:q]}%"))
      .or(joined_groups.where("anonyms.name ILIKE ?", "%#{params[:q]}%"))
      .or(joined_groups.where("composers.name ILIKE ?", "%#{params[:q]}%"))
      .or(joined_groups.where("sources.title ILIKE ?", "%#{params[:q]}%"))
      .or(joined_groups.where("sources.code ILIKE ?", "%#{params[:q]}%"))
      .or(joined_groups.where("sources.location_and_pubscribe ILIKE ?", "%#{params[:q]}%"))
      .or(joined_groups.where("sources.dates ILIKE ?", "%#{params[:q]}%"))
      .or(joined_groups.where("sources.type ILIKE ?", "%#{params[:q]}%"))
      .or(joined_groups.where("editions.voicing ILIKE ?", "%#{params[:q]}%"))
      .or(joined_groups.where("editors.name ILIKE ?", "%#{params[:q]}%"))
      .or(joined_groups.where("editions.file_url ILIKE ?", "%#{params[:q]}%"))
      .or(joined_groups.where("performers.name ILIKE ?", "%#{params[:q]}%"))
      .or(joined_groups.where("recordings.file_url ILIKE ?", "%#{params[:q]}%"))
  end

  def function(groups)
    return groups if params[:function].blank?
    groups.left_outer_joins(:functions).where(functions: {id: params[:function]})
  end

  def composer(groups)
    return groups if params[:composer].blank?
    groups.left_outer_joins(:composers).where(composers: {id: params[:composer]})
  end

  def composer_country(groups)
    return groups if params[:composer_country].blank?
    groups.left_outer_joins(:compositions).where(composers: {birthplace_2: params[:composer_country]})
  end

  def voices(groups)
    return groups if params[:voices].blank?
    groups.left_outer_joins(:compositions).where(compositions: {number_of_voices: params[:voices]})
  end

  def voicing(groups)
    return groups if params[:voicing].blank?
    groups
      .left_outer_joins(compositions: {inclusions: {clef_combination: :voicings}})
      .where(voicings: {id: params[:voicing]})
  end

  def source(groups)
    return groups if params[:source].blank?
    groups.left_outer_joins(:sources).where(sources: {id: params[:source]})
  end

  def has_edition?(groups)
    return groups if params[:has_edition].blank?
    groups.left_outer_joins(:editions).where.not(editions: {id: nil})
  end

  def has_recording?(groups)
    return groups if params[:has_recording].blank?
    groups.left_outer_joins(:recordings).where.not(recordings: {id: nil})
  end
end
