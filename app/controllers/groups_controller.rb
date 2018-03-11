class GroupsController < ApplicationController
  def index
    groups = Group.order(:display_title)
    @groups = filter(groups).includes(
      :recordings,
      :functions,
      compositions: [
        :composers,
        inclusions: [
          :source,
          clefs_inclusions: [
            :clef,
          ],
        ],
      ],
      editions: [
        :editor,
      ],
    ).limit(200)
  end

private

  def filter(groups)
    groups = search(groups)
    groups = function(groups)
    groups = composer(groups)
    groups = composer_country(groups)
    groups = voices(groups)
    groups = source(groups)
    groups = has_edition?(groups)
    has_recording?(groups)
  end

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
    groups.where(functions: {name: params[:function]})
  end

  def composer(groups)
    return groups if params[:composer].blank?
    groups.where(composers: {id: params[:composer]})
  end

  def composer_country(groups)
    return groups if params[:composer_country].blank?
    groups.where(composers: {birthplace_2: params[:composer_country]})
  end

  def voices(groups)
    return groups if params[:voices].blank?
    groups.where(compositions: {number_of_voices: params[:voices]})
  end

  def source(groups)
    return groups if params[:source].blank?
    groups.where(sources: {id: params[:source]})
  end

  def has_edition?(groups)
    return groups if params[:has_edition].blank?
    groups.joins(:editions)
  end

  def has_recording?(groups)
    return groups if params[:has_recording].blank?
    groups.joins(:recordings)
  end
end
