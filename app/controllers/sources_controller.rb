class SourcesController < ApplicationController
  def index
  end

  def edit
    @source = Source.find(params[:id])
    @sources = Source.all

    @grouped_sources = @sources.each_with_object(Hash.new {|h, k| h[k] = []}) { |s, h|
      h[s.catalogued ? "Catalogued" : "Uncatalogued"] << [s.code, s.id]
    }

    @inclusions = @source.inclusions.order(:order).to_a

    last_inclusion = @inclusions.last
    last_order = last_inclusion&.order || -1

    num_blank_rows = [5, (20 - @inclusions.count)].max

    num_blank_rows.times do |n|
      inclusion = @source.inclusions.build(order: last_order + n + 1)
      inclusion.piece = Piece.new
      attributions = inclusion.attributions.build
      attributions.anonym = Anonym.new

      @inclusions << inclusion
    end
  end

  def create
    source = Source.create!(source_params)

    redirect_to sources_path
  end

  def update
    source = Source.find(params[:id])
    source.update!(source_params)

    redirect_to edit_source_path(source)
  end

  def switch_to
    redirect_to edit_source_path(params[:id])
  end

private

  def source_params
    params.require(:source).permit(
      :catalogued,
      :code,
      :date_range,
      :format,
      :publisher_or_scribe,
      :rism_link,
      :title,
      :town,
      :type,
      :url,
      inclusions_attributes: [
        :attributed_to,
        :id,
        :note,
        :order,
        piece_attributes: [
          :id,
          :title,
        ],
      ],
    )
  end
end
